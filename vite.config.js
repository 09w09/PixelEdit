import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'pixeledit-runtime-overrides',
      transformIndexHtml() {
        return [
          {
            tag: 'script',
            attrs: {
              type: 'module',
              src: './svg-vector-runtime.js',
            },
            injectTo: 'body',
          },
          {
            tag: 'script',
            attrs: {
              type: 'module',
              src: './pixel-stroke-runtime.js',
            },
            injectTo: 'body',
          },
        ];
      },
    },
  ],
});
