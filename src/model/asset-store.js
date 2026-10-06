import { nextId } from './ids.js';

class AssetStore {
  constructor(records = []) {
    this.map = new Map();
    this.runtime = new Map();
    for (const record of records || []) this.map.set(record.id, structuredClone(record));
  }
  add(type, dataUrl, meta = {}) { const id = nextId('asset'); this.map.set(id, { id, type, dataUrl, meta: structuredClone(meta) }); return id; }
  set(record) { this.map.set(record.id, structuredClone(record)); return record.id; }
  get(id) { return this.map.get(id) || null; }
  has(id) { return this.map.has(id); }
  findBySha256(type, sha256) { for (const record of this.map.values()) if (record.type === type && record.meta?.sha256 === sha256) return structuredClone(record); return null; }
  setRuntime(id, value) { this.runtime.set(id, value); return value; }
  getRuntime(id) { return this.runtime.get(id) || null; }
  delete(id) { this.runtime.delete(id); return this.map.delete(id); }
  records() { return [...this.map.values()].map(record => structuredClone(record)); }
  bytes() { let bytes = 0; for (const record of this.map.values()) bytes += String(record.dataUrl || '').length; return bytes; }
  referenced(ids) { const out = []; for (const id of ids) if (this.map.has(id)) out.push(structuredClone(this.map.get(id))); return out; }
}

export { AssetStore };
