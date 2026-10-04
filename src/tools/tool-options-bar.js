import { renderShapeToolOptions, SHAPE_TOOLS } from './shape-style-options.js';
import { renderTextToolOptions } from './text-tool-options.js';
import { renderFillToolOptions } from './fill-tool-options.js';
import { ICONS, iconButton, setIconButton } from '../ui/icon-toolbar.js';

const SELECTION_ACTIONS = [
  { action: 'align-left', title: '左对齐', icon: ICONS.alignLeft, run: editor => editor.align('left') },
  { action: 'align-hcenter', title: '水平居中对齐', icon: ICONS.alignHCenter, run: editor => editor.align('hcenter') },
  { action: 'align-right', title: '右对齐', icon: ICONS.alignRight, run: editor => editor.align('right') },
  { action: 'align-top', title: '顶对齐', icon: ICONS.alignTop, run: editor => editor.align('top') },
  { action: 'align-vcenter', title: '垂直居中对齐', icon: ICONS.alignVCenter, run: editor => editor.align('vcenter') },
  { action: 'align-bottom', title: '底对齐', icon: ICONS.alignBottom, run: editor => editor.align('bottom') },
  { action: 'distribute-horizontal', title: '水平分布', icon: ICONS.distributeH, run: editor => editor.distribute('horizontal') },
  { action: 'distribute-vertical', title: '垂直分布', icon: ICONS.distributeV, run: editor => editor.distribute('vertical') },
  { action: 'flip-horizontal', title: '水平翻转', icon: ICONS.flipH, run: editor => editor.runSelectionTransform?.('flip-horizontal') },
  { action: 'flip-vertical', title: '垂直翻转', icon: ICONS.flipV, run: editor => editor.runSelectionTransform?.('flip-vertical') },
  { action: 'rotate-cw-90', title: '顺时针旋转 90°', icon: ICONS.rotateCw, run: editor => editor.runSelectionTransform?.('rotate-cw-90') },
  { action: 'rotate-ccw-90', title: '逆时针旋转 90°', icon: ICONS.rotateCcw, run: editor => editor.runSelectionTransform?.('rotate-ccw-90') },
];

function actionRequirement(action) {
  if (action.startsWith('align-')) return 2;
  if (action.startsWith('distribute-')) return 3;
  return 1;
}

function ensureStyles() {
  if (document.querySelector('#pixeleditToolOptionsStyles')) return;
  const style = document.createElement('style');
  style.id = 'pixeleditToolOptionsStyles';
  style.textContent = `
    :root{--tool-options-h:40px}
    .app{grid-template-rows:var(--top-h) var(--tool-options-h) 1fr var(--status-h)!important}
    #toolOptionsBar{display:flex;align-items:center;gap:5px;padding:4px 8px;background:#1d1d1d;border-bottom:1px solid var(--line);overflow-x:auto;white-space:nowrap;min-width:0}
    #toolOptionsBar:empty::before{content:'无工具属性';color:#777;font-size:11px}
    .toolbar-icon-button{display:inline-grid;place-items:center;width:30px;height:30px;padding:5px;flex:0 0 30px}
    .toolbar-icon-button svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
    .toolbar-icon-button[aria-pressed="true"]{background:#e8e8e8;color:#111}
    .tool-option-group{display:flex;align-items:center;gap:5px;padding-right:7px;margin-right:2px;border-right:1px solid #4a4a4a}
    .tool-option-group:last-child{border-right:0}
    .tool-option-field{display:flex;align-items:center;gap:4px;color:#bbb;font-size:11px}
    .tool-option-field input{width:64px}
    .tool-option-field select{width:auto;min-width:72px}
    #toolOptionRotation{width:68px}
    #toolOptionFont{min-width:150px}
    #globalToolbar .toolbar-icon-button{width:30px;height:30px;padding:5px}
  `;
  document.head.appendChild(style);
}

function fieldLabel(text, control) {
  const label = document.createElement('label');
  label.className = 'tool-option-field';
  const span = document.createElement('span');
  span.textContent = text;
  label.append(span, control);
  return label;
}

function numberInput(id, value, min = 1, max = 100) {
  const input = document.createElement('input');
  input.id = id;
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = '1';
  input.value = String(value);
  return input;
}

function selectInput(id, options, value) {
  const select = document.createElement('select');
  select.id = id;
  for (const [optionValue, label] of options) {
    const option = document.createElement('option');
    option.value = String(optionValue);
    option.textContent = label;
    select.appendChild(option);
  }
  select.value = String(value);
  return select;
}

function group(...children) {
  const element = document.createElement('div');
  element.className = 'tool-option-group';
  element.append(...children);
  return element;
}

class ToolOptionsBar {
  constructor(editor, element) {
    this.editor = editor;
    this.element = element;
  }

  modifiableSelectionCount() {
    const runtime = globalThis.PixelEditor?.selectionTransform;
    if (!runtime?.modifiableSelectionRoots) return this.editor.state.selection.ids.length;
    return runtime.modifiableSelectionRoots(this.editor.activePage(), this.editor.state.selection).length;
  }

  renderSelectionTools() {
    const fragment = document.createDocumentFragment();
    const alignGroup = group();
    const distributeGroup = group();
    const transformGroup = group();
    const modifiableCount = this.modifiableSelectionCount();
    for (const definition of SELECTION_ACTIONS) {
      const button = iconButton({ action: definition.action, title: definition.title, svg: definition.icon });
      button.disabled = modifiableCount < actionRequirement(definition.action);
      button.addEventListener('click', () => definition.run(this.editor));
      if (definition.action.startsWith('align-')) alignGroup.appendChild(button);
      else if (definition.action.startsWith('distribute-')) distributeGroup.appendChild(button);
      else transformGroup.appendChild(button);
    }
    const angle = numberInput('toolOptionRotation', 0, -3600, 3600);
    angle.setAttribute('aria-label', '旋转角度');
    angle.disabled = modifiableCount < 1;
    const rotate = iconButton({ action: 'rotate-angle', title: '旋转指定角度', svg: ICONS.rotateCw });
    rotate.disabled = modifiableCount < 1;
    rotate.addEventListener('click', () => {
      const value = Number(angle.value);
      if (Number.isFinite(value) && value !== 0) this.editor.runSelectionTransform?.('rotate-angle', value);
    });
    transformGroup.append(fieldLabel('旋转', angle), rotate);
    fragment.append(alignGroup, distributeGroup, transformGroup);
    this.element.replaceChildren(fragment);
  }

  bindDefault(control, key, convert = value => value) {
    control.addEventListener('change', () => {
      this.editor.setToolDefault(this.editor.tool, key, convert(control.value));
    });
  }

  renderPaintTool(tool) {
    const settings = this.editor.getToolDefaults(tool);
    const controls = [];
    const width = numberInput('toolOptionWidth', settings.width ?? 1, 1, 100);
    this.bindDefault(width, 'width', value => Math.max(1, Math.min(100, Math.round(Number(value) || 1))));
    controls.push(fieldLabel('宽度', width));
    if (tool !== 'eraser') {
      const color = selectInput('toolOptionColor', [[1, '黑'], [0, '白']], settings.color ?? 1);
      this.bindDefault(color, 'color', value => Number(value) === 0 ? 0 : 1);
      controls.push(fieldLabel('颜色', color));
    }
    this.element.replaceChildren(group(...controls));
  }

  render() {
    if (!this.element) return;
    const tool = this.editor.tool;
    if (tool === 'pointer' || tool === 'select') this.renderSelectionTools();
    else if (tool === 'text') renderTextToolOptions(this.editor, this.element);
    else if (SHAPE_TOOLS.has(tool)) renderShapeToolOptions(this.editor, this.element, tool);
    else if (tool === 'pencil' || tool === 'eraser') this.renderPaintTool(tool);
    else if (tool === 'bucket') renderFillToolOptions(this.editor, this.element, 'bucket');
    else this.element.replaceChildren();
  }

  destroy() {
    this.element?.replaceChildren();
  }
}

function installGlobalToolbar(editor) {
  ensureStyles();
  const topbar = document.querySelector('.topbar');
  if (!topbar) return null;
  topbar.id = 'globalToolbar';

  const alignment = topbar.querySelector('.align-actions');
  alignment?.remove();

  setIconButton(document.querySelector('#undoBtn'), { title: '撤销', svg: ICONS.undo });
  setIconButton(document.querySelector('#redoBtn'), { title: '重做', svg: ICONS.redo });

  let toolBar = document.querySelector('#toolOptionsBar');
  if (!toolBar) {
    toolBar = document.createElement('header');
    toolBar.id = 'toolOptionsBar';
    toolBar.setAttribute('aria-label', '工具属性');
    topbar.insertAdjacentElement('afterend', toolBar);
  }

  const title = document.querySelector('#rightTopPane .dock-title');
  if (title) title.textContent = '元素属性';

  let preview = document.querySelector('#transparencyPreviewBtn');
  if (!preview) {
    preview = iconButton({ title: '显示透明区域', svg: ICONS.transparency, pressed: false });
    preview.id = 'transparencyPreviewBtn';
    const grow = topbar.querySelector('.grow');
    topbar.insertBefore(preview, grow || null);
    preview.addEventListener('click', () => {
      editor.setTransparencyPreview(!editor.editorPreferences.transparencyPreview);
    });
  }

  editor.updateTransparencyPreviewButton = () => {
    const enabled = Boolean(editor.editorPreferences?.transparencyPreview);
    preview.setAttribute('aria-pressed', String(enabled));
    preview.title = enabled ? '隐藏透明区域' : '显示透明区域';
    preview.setAttribute('aria-label', preview.title);
  };
  editor.updateTransparencyPreviewButton();
  return toolBar;
}

function installToolOptionsRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.ui?.Workspace) throw new Error('PixelEditor workspace is not initialized');
  if (PE.toolOptionsInstalled) return;
  PE.toolOptionsInstalled = true;
  PE.toolOptions = { ToolOptionsBar, installGlobalToolbar, actionRequirement, SELECTION_ACTIONS };
}

export { SELECTION_ACTIONS, ToolOptionsBar, actionRequirement, installGlobalToolbar, installToolOptionsRuntime };
