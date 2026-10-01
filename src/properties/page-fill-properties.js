function installPageFillPropertiesRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  const UpdatePageCommand = PE?.commands?.UpdatePageCommand;
  const normalizeFill = PE?.schemaV17?.normalizeFill;
  if (!Properties || !UpdatePageCommand || !normalizeFill) throw new Error('PixelEditor V17 page fill property dependencies are not initialized');
  if (PE.pageFillPropertiesInstalled) return;
  PE.pageFillPropertiesInstalled = true;

  const originalRenderPage = Properties.prototype.renderPage;
  Properties.prototype.renderPage = function renderCanonicalPageFill(page) {
    originalRenderPage.call(this, page);
    if (page.fill?.mode !== 'solid') return;
    const control = this.el?.querySelector?.('#propBgSolid');
    if (!control) return;
    const canonical = normalizeFill(page.fill, { background: true });
    control.value = String(canonical.color);
    control.onchange = () => {
      const color = Number(control.value) === 1 ? 1 : 0;
      this.editor.exec(new UpdatePageCommand(
        page.id,
        current => ({ fill: { ...normalizeFill(current.fill, { background: true }), mode: 'solid', color } }),
        '背景颜色',
      ));
    };
  };
}

export { installPageFillPropertiesRuntime };
