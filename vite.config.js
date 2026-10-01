import { defineConfig } from 'vite';

const buildSha = process.env.GITHUB_SHA || 'local';
const buildInfo = JSON.stringify({ sha: buildSha });

export default defineConfig({
  base: './',
  plugins: [
    {
      name: 'pixeledit-build-info',
      configureServer(server) {
        server.middlewares.use('/build-info.json', (_request, response) => {
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Cache-Control', 'no-store');
          response.end(buildInfo);
        });
      },
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build-info.json',
          source: buildInfo,
        });
      },
    },
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
