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

顶部「显示页面透明区域」会用浅蓝色标记**整页最终合成结果的真正透明像素（包括页面背景）**。黑色和白色都视为不透明；无需选中任何图层。预览层不会被保存或导出。

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
