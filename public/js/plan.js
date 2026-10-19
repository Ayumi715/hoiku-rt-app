const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => String(Math.round(n * 100) / 100);

// W:幅(横) D:奥行(縦)  1mごとに升目を描く
export function planSvg(W, D, { points = [], active = -1, done = [], sections = [] } = {}) {
  const VW = 320, VH = 270, m = 32;
  const s = Math.min((VW - m * 2) / W, (VH - m * 2) / D);
  const rw = W * s, rd = D * s;
  const x0 = (VW - rw) / 2 + 8, y0 = (VH - rd) / 2 + 4;
  let g = "";
  if (sections.length > 1) {
    for (const section of sections) {
      const sx = x0 + section.x * s, sy = y0 + section.y * s;
      const sw = section.width * s, sd = section.depth * s;
      for (let i = 1; i < section.width; i++) g += `<line x1="${sx + i * s}" y1="${sy}" x2="${sx + i * s}" y2="${sy + sd}" stroke="currentColor" stroke-opacity=".15"/>`;
      for (let j = 1; j < section.depth; j++) g += `<line x1="${sx}" y1="${sy + j * s}" x2="${sx + sw}" y2="${sy + j * s}" stroke="currentColor" stroke-opacity=".15"/>`;
    }
    const [first, second] = sections;
    const x1 = x0 + first.width * s;
    const y1 = y0 + first.y * s;
    const y2 = y0 + second.y * s;
    g += `<path d="M ${x0} ${y1} H ${x1} V ${y2} H ${x0 + rw} V ${y0 + rd} H ${x0} Z" fill="none" stroke="currentColor" stroke-width="3"/>`;
    g += `<line x1="${x1}" y1="${Math.max(y1, y2)}" x2="${x1}" y2="${y0 + rd}" stroke="currentColor" stroke-opacity=".35"/>`;
  } else {
    g += `<rect x="${x0}" y="${y0}" width="${rw}" height="${rd}" fill="none" stroke="currentColor" stroke-width="3"/>`;
    for (let i = 1; i < W; i++) g += `<line x1="${x0 + i * s}" y1="${y0}" x2="${x0 + i * s}" y2="${y0 + rd}" stroke="currentColor" stroke-opacity=".15"/>`;
    for (let j = 1; j < D; j++) g += `<line x1="${x0}" y1="${y0 + j * s}" x2="${x0 + rw}" y2="${y0 + j * s}" stroke="currentColor" stroke-opacity=".15"/>`;
  }
  if (sections.length > 1) {
    sections.forEach((section, i) => {
      const sx = x0 + section.x * s, sy = y0 + section.y * s;
      const sw = section.width * s, sd = section.depth * s;
      const depthX = i === 0 ? sx - 10 : sx + sw + 10;
      g += `<text x="${sx + sw / 2}" y="${sy - 8}" text-anchor="middle" font-size="11" fill="currentColor">幅 ${esc(fmt(section.width))} m</text>`;
      g += `<text transform="translate(${depthX} ${sy + sd / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor">奥行 ${esc(fmt(section.depth))} m</text>`;
    });
  } else {
    g += `<text x="${x0 + rw / 2}" y="${y0 - 8}" text-anchor="middle" font-size="12" fill="currentColor">幅 ${esc(fmt(W))} m</text>`;
    g += `<text transform="translate(${x0 - 10} ${y0 + rd / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="currentColor">奥行 ${esc(fmt(D))} m</text>`;
  }
  g += `<text x="${x0 + rw}" y="${y0 + rd + 16}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity=".7">1マス = 1 m</text>`;

  points.forEach((p, i) => {
    const cx = x0 + p.x * s, cy = y0 + p.y * s;
    const isDone = done.includes(i);
    g += `<g data-point="${i}" style="cursor:pointer">`;
    if (i === active) g += `<circle class="pulse" cx="${cx}" cy="${cy}" r="14" style="fill:var(--accent)" opacity=".4"/>`;
    g += `<circle cx="${cx}" cy="${cy}" r="12" style="fill:${isDone ? "var(--accent)" : "var(--panel)"};stroke:var(--accent)" stroke-width="2.5"/>`;
    g += `<text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="13" font-weight="700" style="fill:${isDone ? "var(--accent-ink)" : "var(--ink)"}">${i + 1}</text></g>`;
  });
  return g;
}