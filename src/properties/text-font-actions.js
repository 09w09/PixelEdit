function stripFontActionButtons(html) {
  return String(html || '').replace(
    /<button\s+id="(?:importFontBtn|removeFontBtn)"[^>]*>[\s\S]*?<\/button>/g,
    '',
  );
}

function installTextFontActionsRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  const Properties = PE?.ui?.Properties;
  if (!Properties) throw new Error('PixelEditor text property dependencies are not initialized');
  if (PE.textFontActionsInstalled) return;
  PE.textFontActionsInstalled = true;

  const originalTypeFields = Properties.prototype.typeFields;
  Properties.prototype.typeFields = function typeFieldsWithoutFontManagement(nodes, locked) {
    const html = originalTypeFields.call(this, nodes, locked);
    if (nodes?.[0]?.type !== 'text') return html;
    return stripFontActionButtons(html);
  };

  PE.textFontActions = { stripFontActionButtons };
}

export { stripFontActionButtons, installTextFontActionsRuntime };
