const BUILTIN_FONT_OPTIONS = Object.freeze([
  { value: 'sans-serif', label: '系统默认中文' },
  { value: 'Microsoft YaHei, sans-serif', label: '微软雅黑' },
  { value: 'PingFang SC, sans-serif', label: '苹方' },
  { value: 'Noto Sans CJK SC, Source Han Sans SC, sans-serif', label: '思源黑体 / Noto' },
  { value: 'WenQuanYi Micro Hei, sans-serif', label: '文泉驿微米黑' },
  { value: 'SimHei, sans-serif', label: '黑体' },
  { value: 'SimSun, serif', label: '宋体' },
  { value: 'KaiTi, serif', label: '楷体' },
  { value: 'FangSong, serif', label: '仿宋' },
  { value: 'Noto Sans Mono CJK SC, monospace', label: '等宽中文' },
]);

const clampSize = value => Math.max(1, Math.min(200, Math.round(Number(value) || 16)));

function fontRecordForFamily(project, family) {
  return (project?.fonts || []).find(record => record.family === family) || null;
}

function fontOptions(project) {
  return [
    ...BUILTIN_FONT_OPTIONS.map(option => ({ ...option, imported: false, fixedSize: null })),
    ...(project?.fonts || []).map(record => ({
      value: record.family,
      label: record.name || record.family,
      imported: true,
      fixedSize: Number(record.fixedSize) > 0 ? Number(record.fixedSize) : null,
    })),
  ];
}

function isKnownFamily(project, family) {
  return BUILTIN_FONT_OPTIONS.some(option => option.value === family) || Boolean(fontRecordForFamily(project, family));
}

function resolveTextToolSelection(preferences, project, family = preferences?.fontFamily) {
  const source = preferences || {};
  const fontFamily = isKnownFamily(project, family) ? family : 'sans-serif';
  const record = fontRecordForFamily(project, fontFamily);
  const fixedSize = Number(record?.fixedSize) > 0 ? clampSize(record.fixedSize) : null;
  const lastScalableFontSize = clampSize(source.lastScalableFontSize ?? source.fontSize ?? 16);
  const fontSize = fixedSize || clampSize(source.fontSize ?? lastScalableFontSize);
  return { fontFamily, fontSize, lastScalableFontSize, fixed: fixedSize != null, fixedSize };
}

function installFontOptionsRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE) throw new Error('PixelEditor font option dependencies are not initialized');
  if (PE.fontOptionsInstalled) return;
  PE.fontOptionsInstalled = true;
  PE.fontOptions = { BUILTIN_FONT_OPTIONS, fontOptions, fontRecordForFamily, resolveTextToolSelection };
}

export { BUILTIN_FONT_OPTIONS, fontOptions, fontRecordForFamily, resolveTextToolSelection, installFontOptionsRuntime };
