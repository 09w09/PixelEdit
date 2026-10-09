# PixelEdit

面向 **400×300 黑白像素屏** 的网页像素编辑器。

## 在线使用

https://09w09.github.io/PixelEdit/

## 本地开发

需要 Node.js 20+。

```bash
git clone https://github.com/09w09/PixelEdit.git
cd PixelEdit
npm install
npm run dev
```

终端会输出本地访问地址，通常为 `http://localhost:5173/`。

## 构建

```bash
npm run build
npm run preview
```

构建结果位于 `dist/`。

## 透明区域预览

页面属性的「背景填充」支持**白色、黑色、透明**，也支持不透明的抖动和图案。默认白色背景是完全不透明的。透明背景下，编辑画布显示灰白棋盘格作为参考。

顶部「显示图层透明区域」会将**可见、有面积图层范围内仍然透明的像素**以浅蓝色填充预览。页面真实背景仍按原来的白色、黑色或图案绘制，画布其他位置不着色；线条本身不会构成一整块透明区域，黑白不透明像素也不会被着色。支持图层叠加、裁剪及变换，不依赖当前选中对象。该着色只是编辑视图的辅助显示，不修改工程、PNG 或硬件 1-bit 输出。

「导出 PNG」保留真实 Alpha（透明背景才能产生透明 PNG）；给黑白硬件使用的 `renderPage()` 始终产生不透明的 1-bit 数据，将透明像素合成到白底。

## 数据与兼容性

仅接受 V17 工程，不提供旧格式迁移。打开其他工程会检查未保存修改，并在资源校验成功后替换当前工程。

Chrome 系浏览器优先通过文件选择器保存；其他浏览器采用下载文件方式。浏览器无法确认用户已将下载文件写入磁盘，因此下载后仍保留未保存警告。自动恢复使用本地存储，空间不足或被禁用时会提示失败。重要作品应主动导出 `.pix` 文件。

图片、SVG、字体和工程文件实施尺寸、数量及内容安全限制；不支持引用外部资源的 SVG。

## 测试

```bash
npm install
npx playwright install chromium
npm test
npm run build
npm run test:preview
```

Firefox / WebKit 兼容性冒烟测试：

```bash
npx playwright install firefox webkit
npm run test:compat
```
