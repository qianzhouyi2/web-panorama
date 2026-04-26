# 360° 全景照片查看器

一个纯前端的三维全景照片查看器，可部署在 GitHub Pages 上。

## 功能

- **拖拽旋转** - 鼠标/触摸拖动旋转视角
- **滚轮缩放** - 鼠标滚轮或双指捏合缩放
- **自动旋转** - 一键开启画面自动旋转
- **陀螺仪模式** - 手机陀螺仪体感操控（支持 iOS/Android）
- **上传全景图** - 支持点击上传或拖拽图片到窗口
- **全屏模式** - 沉浸式全屏查看
- **键盘快捷键** - WASD/方向键旋转，+/- 缩放，R 自动旋转，G 陀螺仪，F 全屏，0 重置
- **URL 参数** - 通过 `?url=图片地址` 加载远程全景图

## 部署到 GitHub Pages

1. Fork 或上传本项目到 GitHub 仓库
2. 在仓库 Settings → Pages → Source 选择 `main` 分支
3. 保存后等待部署完成，访问 `https://你的用户名.github.io/仓库名/` 即可

## 本地运行

任意 HTTP 服务器即可，例如：

```bash
# Python 3
python3 -m http.server 8000

# Node.js
npx serve .
```

然后打开 `http://localhost:8000`

## 示例全景图

`examples/` 目录包含几张 AI 生成的 360° 等距柱状投影示例图，可通过 URL 参数直接加载：

- `http://localhost:8000/?url=examples/alpine-lake-sunrise.png`
- `http://localhost:8000/?url=examples/cyberpunk-city-night.png`
- `http://localhost:8000/?url=examples/desert-canyon-golden-hour.png`

## 全景图格式

支持标准的等距柱状投影（equirectangular）全景图，宽高比为 2:1。可从以下来源获得全景图：
- 手机全景模式拍摄
- 360° 相机拍摄
- 网络下载
