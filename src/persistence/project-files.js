import { ProjectSerializer } from './project-serializer.js';
import { MAX_PROJECT_BYTES, assertSize } from '../model/resource-limits.js';

const PIX_FILE_TYPE = { description: 'Pixel Editor Project (*.pix)', accept: { 'application/json': ['.pix'] } };

class ProjectFiles {
  constructor(state, io = {}) { this.state = state; this.io = io; }
  serialize() { return ProjectSerializer.serialize(this.state.project, this.state.assets); }
  async write(handle, raw) {
    const writer = await handle.createWritable();
    try { await writer.write(raw); await writer.close(); }
    catch (error) { await writer.abort?.().catch(() => {}); throw error; }
  }
  async saveAs() {
    const picker = this.io.showSaveFilePicker || globalThis.showSaveFilePicker;
    if (!picker) throw new Error('浏览器不支持文件保存选择器');
    const handle = await picker({ suggestedName: this.state.projectFileName?.endsWith('.pix')
      ? this.state.projectFileName : 'pixel-project-v17.pix', types: [PIX_FILE_TYPE] });
    if (!handle) return null;
    const raw = this.serialize();
    await this.write(handle, raw);
    this.state.projectFileHandle = handle;
    this.state.projectFileName = handle.name || 'pixel-project-v17.pix';
    return raw;
  }
  async save() {
    if (!this.state.projectFileHandle) return this.saveAs();
    const raw = this.serialize();
    await this.write(this.state.projectFileHandle, raw);
    return raw;
  }
  // Opening only returns a candidate. The Workspace commits it after confirmation
  // and after resources are decoded, so a failed import never overwrites current work.
  async open() {
    const picker = this.io.showOpenFilePicker || globalThis.showOpenFilePicker;
    if (!picker) throw new Error('浏览器不支持文件打开选择器');
    const handles = await picker({ multiple: false, types: [PIX_FILE_TYPE] });
    const handle = handles?.[0];
    if (!handle) return null;
    const file = await handle.getFile();
    assertSize(file.size, MAX_PROJECT_BYTES, '工程文件');
    return { ...ProjectSerializer.deserialize(await file.text()), handle, name: handle.name || file.name || '' };
  }
}
export { ProjectFiles, PIX_FILE_TYPE };
