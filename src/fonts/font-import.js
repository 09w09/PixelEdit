function bytesToDataUrl(bytes, mime = 'font/ttf') {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime || 'font/ttf'};base64,${btoa(binary)}`;
}

function inferFixedFontSize(name) {
  const match = String(name || '').match(/(?:^|[_\s-])(\d{1,3})px(?:[_\s.-]|$)/i);
  return match ? Number(match[1]) : null;
}

async function importFonts(editor, files, Model = globalThis.PixelEditor?.model) {
  const records = [];
  let skipped = 0;
  const knownSha = new Set((editor.state.project.fonts || []).map(record => record.sha256).filter(Boolean));

  for (const file of files || []) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await Model.sha256Bytes(bytes);
    if (knownSha.has(sha256)) {
      skipped += 1;
      continue;
    }
    knownSha.add(sha256);

    let asset = editor.state.assets.findBySha256('font', sha256);
    let assetId = asset?.id || null;
    if (!assetId) {
      const mime = file.type || 'font/ttf';
      assetId = editor.state.assets.add('font', bytesToDataUrl(bytes, mime), {
        name: file.name,
        mime,
        sha256,
      });
    }

    const record = {
      name: file.name,
      family: `Imported_${sha256.slice(0, 16)}`,
      fixedSize: inferFixedFontSize(file.name),
      assetId,
      sha256,
    };
    await editor.registerFont(record).catch(() => {});
    records.push(record);
  }

  if (records.length) {
    editor.exec({
      label: '导入字体',
      execute: state => {
        state.project.fonts.push(...records.map(record => structuredClone(record)));
        return true;
      },
    });
  }
  return { imported: records.length, skipped };
}

function installFontImportRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.model?.sha256Bytes || !PE?.ui?.Workspace) throw new Error('PixelEditor is not initialized');
  if (PE.fontImportInstalled) return PE.fontImport;
  PE.fontImportInstalled = true;
  PE.fontImport = { inferFixedFontSize, importFonts };
  return PE.fontImport;
}

export { inferFixedFontSize, importFonts, installFontImportRuntime };
