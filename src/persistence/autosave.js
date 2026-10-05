import { ProjectSerializer } from './project-serializer.js';

const AUTOSAVE_KEY='pixel-editor-v17-autosave';
class Autosave{constructor(state,storage=null,key=AUTOSAVE_KEY){this.state=state;this.key=key;if(storage)this.storage=storage;else{try{this.storage=globalThis.localStorage;}catch{this.storage=null;}}}run(){const raw=ProjectSerializer.serialize(this.state.project,this.state.assets);try{this.storage?.setItem(this.key,raw);}catch{}return raw;}read(){try{const raw=this.storage?.getItem(this.key);return raw?ProjectSerializer.deserialize(raw):null;}catch{return null;}}clear(){try{this.storage?.removeItem(this.key);}catch{}return true;}has(){try{return Boolean(this.storage?.getItem(this.key));}catch{return false;}}}

export { AUTOSAVE_KEY, Autosave };
