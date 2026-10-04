import { normalizeNumber } from './property-system.js';

function sessionFor(editor) { return editor?.properties?.session || null; }
function scheduleRefresh(editor, refresh, afterFrame = null) { sessionFor(editor)?.schedule(refresh, afterFrame); }
function execute(editor, command, refresh, afterFrame = null) { return sessionFor(editor)?.execute(command, refresh, afterFrame) ?? false; }
function beginEditorSession(editor, control, channel = '') { return sessionFor(editor)?.begin(control, channel) || null; }
function endEditorSession(editor, reason = 'property-end') { sessionFor(editor)?.end(reason); }
function bindNumber(control, options = {}) { const { editor, ...rest } = options; return sessionFor(editor)?.bindNumber(control, rest) || control; }
function bindText(control, options = {}) { const { editor, ...rest } = options; return sessionFor(editor)?.bindText(control, rest) || control; }
function bindTextarea(control, options = {}) { const { editor, ...rest } = options; return sessionFor(editor)?.bindTextarea(control, rest) || control; }
function bindSelect(control, options = {}) { const { editor, ...rest } = options; return sessionFor(editor)?.bindSelect(control, rest) || control; }
function bindCheckbox(control, options = {}) { const { editor, ...rest } = options; return sessionFor(editor)?.bindCheckbox(control, rest) || control; }
function installLivePropertyRuntime(target = globalThis) {
  const PE = target.PixelEditor;
  if (!PE?.properties) return null;
  PE.liveProperties = { normalizeNumber, scheduleRefresh, execute, beginEditorSession, endEditorSession, bindNumber, bindText, bindTextarea, bindSelect, bindCheckbox };
  return PE.liveProperties;
}
export { normalizeNumber, scheduleRefresh, execute, beginEditorSession, endEditorSession, bindNumber, bindText, bindTextarea, bindSelect, bindCheckbox, installLivePropertyRuntime };
