import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'pixeledit-module-entry',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          return html.replace(
            '</body>',
            '<script type="module" src="./src/main.js"></script></body>',
          );
        },
      },
    },
  ],
});
