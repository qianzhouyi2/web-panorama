import * as THREE from 'three';

// ============================================================
// 360 Panorama Viewer - GitHub Pages ready
// ============================================================

const container = document.getElementById('canvas-container');
const loading = document.getElementById('loading');
const hint = document.getElementById('hint');
const panoramaTitle = document.getElementById('panorama-title');
const panoramaSelect = document.getElementById('panorama-select');
const btnPrevPanorama = document.getElementById('btn-prev-panorama');
const btnRandomPanorama = document.getElementById('btn-random-panorama');
const btnNextPanorama = document.getElementById('btn-next-panorama');

// ---- Scene Setup ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// ---- Sphere (the panorama canvas) ----
const geometry = new THREE.SphereGeometry(500, 256, 256);
let material = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// ---- State ----
let lon = 0;          // horizontal angle (radians)
let lat = 0;          // vertical angle (radians)
let fov = 75;
const FOV_MIN = 15;
const FOV_MAX = 120;
const LAT_LIMIT = THREE.MathUtils.degToRad(89.4);
const viewTarget = new THREE.Vector3();

let isUserInteracting = false;
let onPointerDownLon = 0;
let onPointerDownLat = 0;
let onPointerDownX = 0;
let onPointerDownY = 0;

let autoRotate = false;
let autoRotateSpeed = 0.3;

let prevTouchDistance = 0;
let prevTouchCenter = { x: 0, y: 0 };
let prevTouchLon = 0;
let prevTouchLat = 0;

// ---- Gyroscope State ----
let gyroscopeActive = false;
let gyroscopeAvailable = false;
let gyroAlpha = 0;       // latest raw alpha (deg)
let gyroBeta = 0;        // latest raw beta (deg)
let gyroGamma = 0;       // latest raw gamma (deg)
let gyroPrevAlpha = 0;   // previous alpha for delta tracking
let gyroPrevBeta = 0;    // previous beta for delta tracking
let gyroInit = false;    // first frame flag
let gyroAccumLon = 0;    // accumulated continuous lon (rad)
let gyroAccumLat = 0;    // accumulated continuous lat (rad)
const GYRO_LERP = 0.08;  // smoothing factor (lower = smoother/slower)

// ---- Texture Loading ----
const BASE_PANORAMAS = [
  { title: '阿尔卑斯湖日出', region: '示例', url: 'examples/alpine-lake-sunrise.png' },
  { title: '赛博城市夜景', region: '示例', url: 'examples/cyberpunk-city-night.png' },
  { title: '沙漠峡谷金色时刻', region: '示例', url: 'examples/desert-canyon-golden-hour.png' },
];
let panoramas = [...BASE_PANORAMAS];
let currentPanoramaIndex = -1;

const POLAR_BAND_RATIO = 0.105;
const POLAR_CAP_RATIO = 0.014;
const POLAR_MAX_BLUR_RATIO = 0.085;

function clampLatitude(value) {
  return Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, value));
}

function normalizeLongitude(value) {
  return THREE.MathUtils.euclideanModulo(value + Math.PI, Math.PI * 2) - Math.PI;
}

function lerpLongitude(current, target, amount) {
  const delta = normalizeLongitude(target - current);
  return normalizeLongitude(current + delta * amount);
}

function smoothstep(edge0, edge1, value) {
  const x = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return x * x * (3 - 2 * x);
}

function configurePanoramaTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function averageRows(data, width, height, startY, rowCount) {
  const y0 = Math.max(0, Math.min(height - 1, startY));
  const y1 = Math.max(y0 + 1, Math.min(height, y0 + rowCount));
  const sum = [0, 0, 0, 0];
  const count = width * (y1 - y0);

  for (let y = y0; y < y1; y += 1) {
    let offset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      sum[0] += data[offset];
      sum[1] += data[offset + 1];
      sum[2] += data[offset + 2];
      sum[3] += data[offset + 3];
      offset += 4;
    }
  }

  return sum.map((value) => value / count);
}

function blurRowCircular(data, rowStart, width, radius, output) {
  if (radius <= 0) {
    output.set(data.subarray(rowStart, rowStart + width * 4));
    return;
  }

  const windowSize = radius * 2 + 1;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;

  for (let dx = -radius; dx <= radius; dx += 1) {
    const x = THREE.MathUtils.euclideanModulo(dx, width);
    const idx = rowStart + x * 4;
    r += data[idx];
    g += data[idx + 1];
    b += data[idx + 2];
    a += data[idx + 3];
  }

  for (let x = 0; x < width; x += 1) {
    const out = x * 4;
    output[out] = r / windowSize;
    output[out + 1] = g / windowSize;
    output[out + 2] = b / windowSize;
    output[out + 3] = a / windowSize;

    const removeX = THREE.MathUtils.euclideanModulo(x - radius, width);
    const addX = THREE.MathUtils.euclideanModulo(x + radius + 1, width);
    const removeIdx = rowStart + removeX * 4;
    const addIdx = rowStart + addX * 4;

    r += data[addIdx] - data[removeIdx];
    g += data[addIdx + 1] - data[removeIdx + 1];
    b += data[addIdx + 2] - data[removeIdx + 2];
    a += data[addIdx + 3] - data[removeIdx + 3];
  }
}

function repairPolarRow(data, width, y, radius, poleColor, strength, capWeight, output) {
  if (strength <= 0) return;

  const rowStart = y * width * 4;
  blurRowCircular(data, rowStart, width, radius, output);

  for (let x = 0; x < width; x += 1) {
    const idx = rowStart + x * 4;
    const out = x * 4;

    for (let channel = 0; channel < 4; channel += 1) {
      const blurred = output[out + channel];
      const target = blurred + (poleColor[channel] - blurred) * capWeight;
      data[idx + channel] += (target - data[idx + channel]) * strength;
    }
  }
}

function repairPolarBand(data, width, bandHeight, poleColor, isTop, maxBlurRadius) {
  const rowBuffer = new Uint8ClampedArray(width * 4);

  for (let i = 0; i < bandHeight; i += 1) {
    const edgeWeight = 1 - i / (bandHeight - 1);
    const strength = smoothstep(0, 1, edgeWeight);
    const radius = Math.round(maxBlurRadius * strength);
    const capWeight = smoothstep(0.58, 1, edgeWeight);
    const y = isTop ? i : bandHeight - 1 - i;

    repairPolarRow(data, width, y, radius, poleColor, strength, capWeight, rowBuffer);
  }
}

function repairPolarBands(ctx, width, height) {
  if (width < 64 || height < 32) return;

  const bandHeight = Math.max(2, Math.round(height * POLAR_BAND_RATIO));
  const capRows = Math.max(1, Math.round(height * POLAR_CAP_RATIO));
  const maxBlurRadius = Math.max(1, Math.round(width * POLAR_MAX_BLUR_RATIO));

  const topBand = ctx.getImageData(0, 0, width, bandHeight);
  const topPoleColor = averageRows(topBand.data, width, bandHeight, 0, capRows);
  repairPolarBand(topBand.data, width, bandHeight, topPoleColor, true, maxBlurRadius);
  ctx.putImageData(topBand, 0, 0);

  const bottomY = height - bandHeight;
  const bottomBand = ctx.getImageData(0, bottomY, width, bandHeight);
  const bottomPoleColor = averageRows(bottomBand.data, width, bandHeight, bandHeight - capRows, capRows);
  repairPolarBand(bottomBand.data, width, bandHeight, bottomPoleColor, false, maxBlurRadius);
  ctx.putImageData(bottomBand, 0, bottomY);
}

function createPanoramaTexture(img) {
  try {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    repairPolarBands(ctx, width, height);

    return configurePanoramaTexture(new THREE.CanvasTexture(canvas));
  } catch (err) {
    console.warn('Pole repair skipped; using original panorama texture.', err);
    return configurePanoramaTexture(new THREE.Texture(img));
  }
}

function loadTextureFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        resolve(createPanoramaTexture(img));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadTextureFromURL(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve(createPanoramaTexture(img));
    };
    img.onerror = reject;
    img.crossOrigin = 'anonymous';
    img.src = url;
  });
}

function panoramaLabel(panorama) {
  return panorama.region ? `${panorama.region} · ${panorama.title}` : panorama.title;
}

function populatePanoramaSelect() {
  if (!panoramaSelect) return;
  panoramaSelect.innerHTML = '';
  panoramas.forEach((panorama, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = panoramaLabel(panorama);
    panoramaSelect.appendChild(option);
  });
}

function updatePanoramaUI(panorama) {
  if (panoramaTitle) {
    panoramaTitle.textContent = panorama ? panoramaLabel(panorama) : '外部全景图';
  }
  if (panoramaSelect) {
    panoramaSelect.value = currentPanoramaIndex >= 0 ? String(currentPanoramaIndex) : '';
  }
}

async function loadGeneratedPanoramas() {
  try {
    const response = await fetch('examples/generated-panoramas/manifest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const generated = await response.json();
    panoramas = [
      ...BASE_PANORAMAS,
      ...generated.map((item) => ({
        title: item.title,
        region: item.region,
        url: item.path,
      })),
    ];
  } catch (err) {
    console.warn('无法加载生成全景图库，使用内置示例:', err);
    panoramas = [...BASE_PANORAMAS];
  }
  populatePanoramaSelect();
}

async function loadPanoramaByIndex(index) {
  if (!panoramas.length) return;
  currentPanoramaIndex = (index + panoramas.length) % panoramas.length;
  const panorama = panoramas[currentPanoramaIndex];
  showLoading();
  try {
    const texture = await loadTextureFromURL(panorama.url);
    applyTexture(texture);
    updatePanoramaUI(panorama);
  } catch (err) {
    hideLoading();
    alert('加载全景图失败: ' + err.message);
  }
}

async function loadExternalPanorama(url) {
  currentPanoramaIndex = -1;
  showLoading();
  try {
    const texture = await loadTextureFromURL(url);
    applyTexture(texture);
    updatePanoramaUI({ title: 'URL 图片', region: '外部' });
  } catch {
    hideLoading();
    alert('加载远程全景图失败，请检查 URL');
  }
}

// ---- Show/Hide Loading ----
function showLoading() {
  loading.classList.remove('hidden');
}

function hideLoading() {
  loading.classList.add('hidden');
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 4000);
}

// ---- Apply Texture ----
function applyTexture(texture) {
  material.map = texture;
  material.needsUpdate = true;
  hideLoading();
}

// ---- Camera Update ----
function updateCamera() {
  lat = clampLatitude(lat);
  lon = normalizeLongitude(lon);

  const cosLat = Math.cos(lat);
  viewTarget.set(
    -cosLat * Math.cos(lon),
    -Math.sin(lat),
    -cosLat * Math.sin(lon)
  );

  camera.position.set(0, 0, 0);
  camera.lookAt(viewTarget);
}

// ---- Gyroscope ----
function initGyroscope() {
  // Check API availability
  if (typeof DeviceOrientationEvent === 'undefined') return;

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ - need explicit user gesture to request
    gyroscopeAvailable = true;
    return;
  }

  // Check if we actually get valid orientation data
  const handler = (event) => {
    if (event.alpha !== null) {
      gyroscopeAvailable = true;
      window.removeEventListener('deviceorientation', handler);
    }
  };
  window.addEventListener('deviceorientation', handler);
  // Remove after timeout if no data
  setTimeout(() => window.removeEventListener('deviceorientation', handler), 2000);
}

function toggleGyroscope() {
  if (!gyroscopeAvailable) {
    alert('此设备不支持陀螺仪或不支持 DeviceOrientation API。\n\n请使用支持陀螺仪的手机查看。');
    return;
  }

  // iOS 13+ permission request
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then((state) => {
        if (state === 'granted') {
          enableGyroscope();
        } else {
          alert('需要授予运动传感器权限才能使用陀螺仪功能');
        }
      })
      .catch(() => {
        alert('陀螺仪权限请求失败，请在系统设置中允许运动传感器权限');
      });
    return;
  }

  if (gyroscopeActive) {
    disableGyroscope();
  } else {
    enableGyroscope();
  }
}

function enableGyroscope() {
  gyroscopeActive = true;
  gyroInit = false;
  gyroAccumLon = lon;
  gyroAccumLat = lat;
  autoRotate = false;

  btnGyroscope.classList.add('active');
  btnAutoRotate.classList.remove('active');
  gyroIndicator.style.display = 'block';
  hint.textContent = '手机陀螺仪已激活 — 移动手机查看全景';
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 4000);

  window.addEventListener('deviceorientation', onDeviceOrientation);
}

function disableGyroscope() {
  gyroscopeActive = false;
  btnGyroscope.classList.remove('active');
  gyroIndicator.style.display = 'none';
  hint.textContent = '拖拽旋转 / 滚轮缩放 / 手机陀螺仪';
  hint.classList.remove('hidden');
  setTimeout(() => hint.classList.add('hidden'), 3000);
  window.removeEventListener('deviceorientation', onDeviceOrientation);
}

function onDeviceOrientation(event) {
  if (event.alpha === null) return;

  const rawAlpha = event.alpha;   // 0~360 compass direction
  const rawBeta = event.beta;     // -180~180 front/back tilt

  if (!gyroInit) {
    // First frame: just record, no delta
    gyroPrevAlpha = rawAlpha;
    gyroPrevBeta = rawBeta;
    gyroInit = true;
    return;
  }

  // Compute delta alpha, normalize to [-180, 180] to handle 0↔360 wrap
  let deltaAlpha = rawAlpha - gyroPrevAlpha;
  if (deltaAlpha > 180) deltaAlpha -= 360;
  if (deltaAlpha < -180) deltaAlpha += 360;

  // Compute delta beta, normalize to handle -180↔180 wrap
  let deltaBeta = rawBeta - gyroPrevBeta;
  if (deltaBeta > 180) deltaBeta -= 360;
  if (deltaBeta < -180) deltaBeta += 360;

  // Accumulate continuous rotation (negated for correct direction)
  gyroAccumLon = normalizeLongitude(gyroAccumLon - THREE.MathUtils.degToRad(deltaAlpha));
  gyroAccumLat = clampLatitude(gyroAccumLat - THREE.MathUtils.degToRad(deltaBeta));

  gyroPrevAlpha = rawAlpha;
  gyroPrevBeta = rawBeta;
  gyroAlpha = rawAlpha;
  gyroBeta = rawBeta;
}

function updateGyroscope() {
  if (!gyroscopeActive) return;

  // Smooth lerp toward accumulated continuous rotation
  lon = lerpLongitude(lon, gyroAccumLon, GYRO_LERP);
  lat += (gyroAccumLat - lat) * GYRO_LERP;
}

// ---- Event Handlers ----
function onPointerDown(event) {
  if (event.target.closest('#controls, #panorama-browser')) return;
  isUserInteracting = true;
  onPointerDownX = event.clientX;
  onPointerDownY = event.clientY;
  onPointerDownLon = lon;
  onPointerDownLat = lat;
  container.classList.add('grabbing');
}

function onPointerMove(event) {
  if (!isUserInteracting) return;
  const dx = event.clientX - onPointerDownX;
  const dy = event.clientY - onPointerDownY;
  lon = onPointerDownLon - dx * 0.005;
  lat = onPointerDownLat + dy * 0.005;
}

function onPointerUp() {
  isUserInteracting = false;
  container.classList.remove('grabbing');
}

function onWheel(event) {
  if (event.target.closest('#panorama-browser')) return;
  event.preventDefault();
  fov += event.deltaY * 0.05;
  fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov));
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

// ---- Touch Handlers for Mobile ----
function onTouchStart(event) {
  if (event.target.closest('#controls, #panorama-browser')) return;
  if (event.touches.length === 1) {
    isUserInteracting = true;
    onPointerDownX = event.touches[0].clientX;
    onPointerDownY = event.touches[0].clientY;
    onPointerDownLon = lon;
    onPointerDownLat = lat;
    container.classList.add('grabbing');
  } else if (event.touches.length === 2) {
    prevTouchDistance = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
    prevTouchCenter = {
      x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
    };
    prevTouchLon = lon;
    prevTouchLat = lat;
    isUserInteracting = false;
  }
}

function onTouchMove(event) {
  if (event.touches.length === 1 && isUserInteracting) {
    const dx = event.touches[0].clientX - onPointerDownX;
    const dy = event.touches[0].clientY - onPointerDownY;
    lon = onPointerDownLon - dx * 0.005;
    lat = onPointerDownLat + dy * 0.005;
  } else if (event.touches.length === 2) {
    const dist = Math.hypot(
      event.touches[0].clientX - event.touches[1].clientX,
      event.touches[0].clientY - event.touches[1].clientY
    );
    const scale = prevTouchDistance / dist;
    fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov * scale));
    camera.fov = fov;
    camera.updateProjectionMatrix();
    prevTouchDistance = dist;

    const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    lon = prevTouchLon - (cx - prevTouchCenter.x) * 0.005;
    lat = prevTouchLat + (cy - prevTouchCenter.y) * 0.005;
  }
}

function onTouchEnd(event) {
  if (event.touches.length === 0) {
    isUserInteracting = false;
    container.classList.remove('grabbing');
  }
}

// ---- Button Handlers ----
const fileInput = document.getElementById('file-input');
const btnGyroscope = document.getElementById('btn-gyroscope');
const gyroIndicator = document.getElementById('gyro-indicator');

document.getElementById('btn-upload').addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  showLoading();
  try {
    const texture = await loadTextureFromFile(file);
    applyTexture(texture);
  } catch (err) {
    alert('加载图片失败: ' + err.message);
    hideLoading();
  }
});

// Allow drag and drop
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  showLoading();
  try {
    const texture = await loadTextureFromFile(file);
    applyTexture(texture);
  } catch (err) {
    alert('加载图片失败: ' + err.message);
    hideLoading();
  }
});

const btnAutoRotate = document.getElementById('btn-auto-rotate');
btnAutoRotate.addEventListener('click', () => {
  autoRotate = !autoRotate;
  btnAutoRotate.classList.toggle('active', autoRotate);
  if (autoRotate && gyroscopeActive) {
    disableGyroscope();
  }
});

btnGyroscope.addEventListener('click', toggleGyroscope);

panoramaSelect?.addEventListener('change', (e) => {
  loadPanoramaByIndex(Number(e.target.value));
});

btnPrevPanorama?.addEventListener('click', () => {
  loadPanoramaByIndex(currentPanoramaIndex - 1);
});

btnRandomPanorama?.addEventListener('click', () => {
  let nextIndex = Math.floor(Math.random() * panoramas.length);
  if (panoramas.length > 1 && nextIndex === currentPanoramaIndex) {
    nextIndex = (nextIndex + 1) % panoramas.length;
  }
  loadPanoramaByIndex(nextIndex);
});

btnNextPanorama?.addEventListener('click', () => {
  loadPanoramaByIndex(currentPanoramaIndex + 1);
});

document.getElementById('btn-zoom-in').addEventListener('click', () => {
  fov = Math.max(FOV_MIN, fov - 10);
  camera.fov = fov;
  camera.updateProjectionMatrix();
});

document.getElementById('btn-zoom-out').addEventListener('click', () => {
  fov = Math.min(FOV_MAX, fov + 10);
  camera.fov = fov;
  camera.updateProjectionMatrix();
});

document.getElementById('btn-reset').addEventListener('click', () => {
  lon = 0;
  lat = 0;
  fov = 75;
  camera.fov = fov;
  camera.updateProjectionMatrix();
  if (gyroscopeActive) {
    gyroAccumLon = 0;
    gyroAccumLat = 0;
  }
  updateCamera();
});

document.getElementById('btn-fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.body.requestFullscreen();
  }
});

// ---- Keyboard Shortcuts ----
document.addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName)) return;
  switch (e.key.toLowerCase()) {
    case 'arrowleft':
    case 'a':
      lon -= 0.05;
      break;
    case 'arrowright':
    case 'd':
      lon += 0.05;
      break;
    case 'arrowup':
    case 'w':
      lat += 0.05;
      break;
    case 'arrowdown':
    case 's':
      lat -= 0.05;
      break;
    case '+':
    case '=':
      fov = Math.max(FOV_MIN, fov - 5);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      break;
    case '-':
      fov = Math.min(FOV_MAX, fov + 5);
      camera.fov = fov;
      camera.updateProjectionMatrix();
      break;
    case 'r':
      autoRotate = !autoRotate;
      btnAutoRotate.classList.toggle('active', autoRotate);
      if (autoRotate && gyroscopeActive) {
        disableGyroscope();
      }
      break;
    case '0':
      lon = 0;
      lat = 0;
      fov = 75;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      if (gyroscopeActive) {
        gyroAccumLon = 0;
        gyroAccumLat = 0;
      }
      updateCamera();
      break;
    case 'f':
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        document.body.requestFullscreen();
      }
      break;
    case 'g':
      toggleGyroscope();
      break;
  }
});

// ---- Event Listeners ----
document.addEventListener('mousedown', onPointerDown);
document.addEventListener('mousemove', onPointerMove);
document.addEventListener('mouseup', onPointerUp);
document.addEventListener('wheel', onWheel, { passive: false });
container.addEventListener('touchstart', onTouchStart, { passive: false });
container.addEventListener('touchmove', onTouchMove, { passive: false });
container.addEventListener('touchend', onTouchEnd);
container.addEventListener('touchcancel', onTouchEnd);

// ---- Resize ----
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ---- Render Loop ----
function animate() {
  requestAnimationFrame(animate);

  updateGyroscope();

  if (autoRotate && !isUserInteracting) {
    lon += autoRotateSpeed * 0.01;
  }

  updateCamera();
  renderer.render(scene, camera);
}

// ---- Init ----
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
initGyroscope();

animate();

// ---- Check URL params for ?url=... ----
async function initPanorama() {
  await loadGeneratedPanoramas();

  const params = new URLSearchParams(window.location.search);
  const urlParam = params.get('url');
  if (urlParam) {
    await loadExternalPanorama(urlParam);
    return;
  }

  const randomIndex = Math.floor(Math.random() * panoramas.length);
  await loadPanoramaByIndex(randomIndex);
}

initPanorama();
