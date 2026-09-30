import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'pixeledit-svg-vector-runtime',
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
        ];
      },
    },
  ],
});
