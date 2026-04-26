import * as THREE from 'three';

// ============================================================
// 360 Panorama Viewer - GitHub Pages ready
// ============================================================

const container = document.getElementById('canvas-container');
const loading = document.getElementById('loading');
const hint = document.getElementById('hint');

// ---- Scene Setup ----
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(0, 0, 0.1);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
container.appendChild(renderer.domElement);

// ---- Sphere (the panorama canvas) ----
const geometry = new THREE.SphereGeometry(500, 256, 256);
let material = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
material.mapMinFilter = THREE.LinearMipmapLinearFilter;
material.mapMagFilter = THREE.LinearFilter;
material.generateMipmaps = true;
const sphere = new THREE.Mesh(geometry, material);
scene.add(sphere);

// ---- State ----
let lon = 0;          // horizontal angle (radians)
let lat = 0;          // vertical angle (radians)
let fov = 75;
const FOV_MIN = 15;
const FOV_MAX = 120;

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
const SAMPLE_IMAGES = [
  'examples/alpine-lake-sunrise.png',
  'examples/cyberpunk-city-night.png',
  'examples/desert-canyon-golden-hour.png',
];

function loadTextureFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        resolve(texture);
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
      const texture = new THREE.Texture(img);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      resolve(texture);
    };
    img.onerror = reject;
    img.src = url;
  });
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
  lat = Math.max(-Math.PI / 2.01, Math.min(Math.PI / 2.01, lat));

  const phi = Math.PI / 2 - lat;
  const theta = lon;

  const x = 0.1 * Math.sin(phi) * Math.cos(theta);
  const y = 0.1 * Math.cos(phi);
  const z = 0.1 * Math.sin(phi) * Math.sin(theta);

  camera.position.set(x, y, z);
  camera.lookAt(0, 0, 0);
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
  gyroAccumLon -= THREE.MathUtils.degToRad(deltaAlpha);
  gyroAccumLat -= THREE.MathUtils.degToRad(deltaBeta);

  gyroPrevAlpha = rawAlpha;
  gyroPrevBeta = rawBeta;
  gyroAlpha = rawAlpha;
  gyroBeta = rawBeta;
}

function updateGyroscope() {
  if (!gyroscopeActive) return;

  // Smooth lerp toward accumulated continuous rotation
  lon += (gyroAccumLon - lon) * GYRO_LERP;
  lat += (gyroAccumLat - lat) * GYRO_LERP;
}

// ---- Event Handlers ----
function onPointerDown(event) {
  if (event.target.closest('#controls')) return;
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
  event.preventDefault();
  fov += event.deltaY * 0.05;
  fov = Math.max(FOV_MIN, Math.min(FOV_MAX, fov));
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

// ---- Touch Handlers for Mobile ----
function onTouchStart(event) {
  if (event.target.closest('#controls')) return;
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

const randomPic = SAMPLE_IMAGES[Math.floor(Math.random() * SAMPLE_IMAGES.length)];
loadTextureFromURL(randomPic).then(applyTexture);

animate();

// ---- Check URL params for ?url=... ----
const params = new URLSearchParams(window.location.search);
const urlParam = params.get('url');
if (urlParam) {
  showLoading();
  loadTextureFromURL(urlParam)
    .then(applyTexture)
    .catch(() => alert('加载远程全景图失败，请检查 URL'));
}
