const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function markup(state = {}) {
  let output = '';
  for (const bounds of state.selectionRects || []) if (bounds && bounds.w > 0 && bounds.h > 0) output += `<rect class="selection-box" vector-effect="non-scaling-stroke" x="${finite(bounds.x)}" y="${finite(bounds.y)}" width="${finite(bounds.w)}" height="${finite(bounds.h)}"/>`;
  for (const guide of state.smartGuides || []) output += guide.axis === 'x'
    ? `<line class="smart-guide" vector-effect="non-scaling-stroke" x1="${finite(guide.coord)}" y1="0" x2="${finite(guide.coord)}" y2="300"/>`
    : `<line class="smart-guide" vector-effect="non-scaling-stroke" x1="0" y1="${finite(guide.coord)}" x2="400" y2="${finite(guide.coord)}"/>`;
  const marquee = state.marquee;
  if (marquee) output += `<rect class="marquee-box" vector-effect="non-scaling-stroke" x="${finite(marquee.x)}" y="${finite(marquee.y)}" width="${finite(marquee.w)}" height="${finite(marquee.h)}"/>`;
  return output;
}

const OverlayRenderer = Object.freeze({ markup });

export { markup, OverlayRenderer };
