import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'pixeledit-module-entry',
      transformIndexHtml() {
        return [
          {
            tag: 'script',
            attrs: {
              type: 'module',
              src: './src/main.js',
            },
            injectTo: 'body',
          },
        ];
      },
    },
  ],
});
