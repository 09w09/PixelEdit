import { defineConfig } from 'vite';
import baseConfig from './vite.config.js';

export default defineConfig({
  ...baseConfig,
  plugins: [
    ...(baseConfig.plugins || []),
    {
      name: 'pixeledit-test-debug-alias',
      transformIndexHtml() {
        return [{
          tag: 'script',
          attrs: { type: 'module', src: '/tests/debug-compat.js' },
          injectTo: 'head-prepend',
        }];
      },
    },
  ],
});
