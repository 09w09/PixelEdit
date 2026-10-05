import { MoveSelectionCommand, AltDragDuplicateCommand } from '../commands/index.js';

class InteractionController {
  constructor({ state, bus, hitTest, snapEngine = null, getZoom = () => 1, onOverlay = () => {}, onPan = () => {}, modeKind = 'pointer' }) {
    this.state = state;
    this.bus = bus;
    this.hitTest = hitTest;
    this.snapEngine = snapEngine;
    this.getZoom = getZoom;
    this.onOverlay = onOverlay;
    this.onPan = onPan;
    this.modeKind = modeKind === 'marquee' ? 'marquee' : 'pointer';
    this.mode = 'Idle';
    this.start = null;
    this.last = null;
    this.additive = false;
    this.alt = false;
    this.panModifier = false;
    this.candidateHit = null;
  }

  setModeKind(value) { this.modeKind = value === 'marquee' ? 'marquee' : 'pointer'; this.reset(); }
  setPanModifier(value) { this.panModifier = !!value; }
  reset() {
    this.mode = 'Idle';
    this.start = this.last = null;
    this.additive = this.alt = false;
    this.candidateHit = null;
    this.onOverlay({ marquee: null, previewMove: null, smartGuides: [] });
  }

  pointerDown(event) {
    const point = { x: Math.round(event.x), y: Math.round(event.y) };
    this.start = this.last = point;
    this.additive = !!(event.ctrlKey || event.metaKey);
    this.alt = !!event.altKey;
    if (this.panModifier || event.button === 1) { this.mode = 'Panning'; return this.mode; }
    const hit = this.hitTest?.topmostAt?.(point.x, point.y, { ignoreLocked: true }) || null;
    if (this.modeKind === 'marquee') {
      this.state.pageSelectedId = null;
      if (this.additive && hit) { this.candidateHit = hit; this.mode = 'MarqueeClickCandidate'; return this.mode; }
      if (!this.additive) this.state.selection.clear();
      this.mode = 'MarqueeSelecting';
      this.onOverlay({ marquee: { x: point.x, y: point.y, w: 1, h: 1 }, previewMove: null, smartGuides: [] });
      return this.mode;
    }
    if (hit) {
      this.state.pageSelectedId = null;
      if (this.additive) this.state.selection.toggle(hit.id);
      else if (!this.state.selection.has(hit.id)) this.state.selection.replace([hit.id]);
      this.mode = this.alt ? 'DuplicatingSelection' : 'Selecting';
    } else {
      this.state.pageSelectedId = null;
      if (!this.additive) this.state.selection.clear();
      this.mode = 'Idle';
    }
    return this.mode;
  }

  pointerMove(event) {
    if (!this.start) return undefined;
    const point = { x: Math.round(event.x), y: Math.round(event.y) };
    const dx = point.x - this.start.x, dy = point.y - this.start.y, previous = this.last || this.start;
    if (this.mode === 'Panning') { this.onPan({ dx: point.x - previous.x, dy: point.y - previous.y }); this.last = point; return this.mode; }
    this.last = point;
    if (this.mode === 'MarqueeClickCandidate' && (dx || dy)) {
      this.mode = 'MarqueeSelecting';
      this.onOverlay({ marquee: { x: Math.min(this.start.x, point.x), y: Math.min(this.start.y, point.y), w: Math.abs(dx) + 1, h: Math.abs(dy) + 1 }, previewMove: null, smartGuides: [] });
      return this.mode;
    }
    if (this.mode === 'Selecting' && (dx || dy)) this.mode = this.alt || event.altKey ? 'DuplicatingSelection' : 'MovingSelection';
    if (this.mode === 'MovingSelection' || this.mode === 'DuplicatingSelection') {
      let moveX = dx, moveY = dy, smartGuides = [];
      if (this.snapEngine) {
        const result = this.snapEngine.snapMove({ roots: this.state.selection.ids, dx, dy, zoom: this.getZoom(), thresholdPx: 5 });
        moveX = result.dx; moveY = result.dy; smartGuides = result.smartGuides;
      }
      this.onOverlay({ previewMove: { ids: this.state.selection.ids, dx: moveX, dy: moveY }, marquee: null, smartGuides });
    } else if (this.mode === 'MarqueeSelecting') {
      this.onOverlay({ marquee: { x: Math.min(this.start.x, point.x), y: Math.min(this.start.y, point.y), w: Math.abs(dx) + 1, h: Math.abs(dy) + 1 }, previewMove: null, smartGuides: [] });
    }
    return this.mode;
  }

  pointerUp(event) {
    if (!this.start) { this.reset(); return false; }
    const point = { x: Math.round(event.x), y: Math.round(event.y) };
    const dx = point.x - this.start.x, dy = point.y - this.start.y;
    let changed = false, moveX = dx, moveY = dy;
    if ((this.mode === 'MovingSelection' || this.mode === 'DuplicatingSelection') && this.snapEngine) {
      const result = this.snapEngine.snapMove({ roots: this.state.selection.ids, dx, dy, zoom: this.getZoom(), thresholdPx: 5 });
      moveX = result.dx; moveY = result.dy;
    }
    if (this.mode === 'MovingSelection' && (moveX || moveY)) changed = this.bus.execute(new MoveSelectionCommand(this.state.selection.ids, moveX, moveY));
    else if (this.mode === 'DuplicatingSelection' && (moveX || moveY)) changed = this.bus.execute(new AltDragDuplicateCommand(this.state.selection.ids, moveX, moveY));
    else if (this.mode === 'MarqueeClickCandidate' && this.candidateHit) this.state.selection.toggle(this.candidateHit.id);
    else if (this.mode === 'MarqueeSelecting') {
      const rect = { x: Math.min(this.start.x, point.x), y: Math.min(this.start.y, point.y), w: Math.abs(dx) + 1, h: Math.abs(dy) + 1 };
      const ids = (this.hitTest?.intersecting?.(rect, { ignoreLocked: true }) || []).map(node => node.id);
      if (this.additive) this.state.selection.addMany(ids); else this.state.selection.replace(ids);
    }
    this.reset();
    return changed;
  }

  cancel() { this.reset(); return true; }
}

export { InteractionController };
