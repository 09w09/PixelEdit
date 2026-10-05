import { Toolbar } from '../ui/toolbar.js';
import { PageDock } from '../ui/page-dock.js';
import { HistoryDock } from '../ui/history-dock.js';
import { Properties } from '../ui/properties.js';

const PE = globalThis.PixelEditor;

class LegacyProperties extends Properties {
  constructor(editor, el) {
    super(editor, el, PE.properties?.provider || null);
  }
}

Object.assign(PE.ui, { Toolbar, PageDock, HistoryDock, Properties: LegacyProperties });
