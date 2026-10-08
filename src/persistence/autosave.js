import { ProjectSerializer } from './project-serializer.js';

const AUTOSAVE_KEY = 'pixel-editor-v17-autosave';
class Autosave {
  constructor(state, storage = undefined, key = AUTOSAVE_KEY) {
    this.state = state;
    this.key = key;
    this.storage = storage;
    if (storage === undefined) {
      try { this.storage = globalThis.localStorage; } catch { this.storage = null; }
    }
    this.lastError = null;
  }
  run() {
    try {
      if (!this.storage) throw new Error('浏览器本地存储不可用');
      const raw = ProjectSerializer.serialize(this.state.project, this.state.assets);
      this.storage.setItem(this.key, raw);
      this.lastError = null;
      return raw;
    } catch (error) {
      this.lastError = error;
      throw new Error(`自动保存失败：${error?.message || error}`, { cause: error });
    }
  }
  read() {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? ProjectSerializer.deserialize(raw) : null;
    } catch (error) {
      this.lastError = error;
      return null;
    }
  }
  clear() {
    try { this.storage?.removeItem(this.key); this.lastError = null; return true; }
    catch (error) { this.lastError = error; return false; }
  }
  has() {
    try { return Boolean(this.storage?.getItem(this.key)); }
    catch { return false; }
  }
}
export { AUTOSAVE_KEY, Autosave };
