function exposeDebugApi(target, { app, services }) {
  const api = Object.freeze({ app, services });
  Object.defineProperty(target, 'PixelEditorDebug', {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return api;
}

export { exposeDebugApi };
