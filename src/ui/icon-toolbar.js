const ICONS = {
  undo: '<path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/>',
  redo: '<path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/>',
  alignLeft: '<path d="M5 3v18"/><path d="M8 7h10M8 12h7M8 17h11"/>',
  alignHCenter: '<path d="M12 3v18"/><path d="M6 7h12M8 12h8M5 17h14"/>',
  alignRight: '<path d="M19 3v18"/><path d="M6 7h10M9 12h7M5 17h11"/>',
  alignTop: '<path d="M3 5h18"/><path d="M7 8v10M12 8v7M17 8v11"/>',
  alignVCenter: '<path d="M3 12h18"/><path d="M7 6v12M12 8v8M17 5v14"/>',
  alignBottom: '<path d="M3 19h18"/><path d="M7 6v10M12 9v7M17 5v11"/>',
  distributeH: '<path d="M4 4v16M20 4v16"/><rect x="7" y="8" width="3" height="8"/><rect x="14" y="6" width="3" height="12"/>',
  distributeV: '<path d="M4 4h16M4 20h16"/><rect x="8" y="7" width="8" height="3"/><rect x="6" y="14" width="12" height="3"/>',
  flipH: '<path d="M12 3v18"/><path d="m10 7-5 5 5 5M14 7l5 5-5 5"/>',
  flipV: '<path d="M3 12h18"/><path d="m7 10 5-5 5 5M7 14l5 5 5-5"/>',
  rotateCw: '<path d="M18 8V4l3 3-3 3V8a7 7 0 1 0 1 8"/>',
  rotateCcw: '<path d="M6 8V4L3 7l3 3V8a7 7 0 1 1-1 8"/>',
  transparency: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/><path d="M13 4h7v7M4 13h7v7"/>',
};

function svgMarkup(svg) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${svg || ''}</svg>`;
}

function setIconButton(button, { title, svg, pressed = null } = {}) {
  if (!button) return button;
  button.type = 'button';
  button.classList.add('toolbar-icon-button');
  button.title = title || '';
  button.setAttribute('aria-label', title || '');
  if (pressed !== null) button.setAttribute('aria-pressed', String(Boolean(pressed)));
  else button.removeAttribute('aria-pressed');
  button.innerHTML = svgMarkup(svg);
  return button;
}

function iconButton({ action = '', title = '', svg = '', pressed = null } = {}) {
  const button = document.createElement('button');
  setIconButton(button, { title, svg, pressed });
  if (action) button.dataset.toolAction = action;
  return button;
}

export { ICONS, iconButton, setIconButton, svgMarkup };
