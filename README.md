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

顶部的「显示页面透明区域」会用浅蓝色标记**当前页面全部可见内容图层合成后尚未覆盖的像素**，无需选中图层。黑、白像素均为已覆盖；隐藏图层和被裁剪掉的内容不计入。由于 1-bit 页面的底层背景始终不透明，预览刻意不把页面背景计入内容覆盖；此效果只用于编辑检查，不修改实际渲染和 PNG 导出。

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
