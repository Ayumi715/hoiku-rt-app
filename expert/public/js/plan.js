const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => String(Math.round(n * 100) / 100);

// 各エリアの間取りを横に並べて描画(1mごとの升目と測定点つき)
export function planSvg(areas) {
  const rooms = areas
    .filter(a => a.room && a.room.width > 0 && a.room.depth > 0)
    .map(a => ({
      W: Number(a.room.width), D: Number(a.room.depth),
      label: areas.length > 1 ? `部屋${(a.roomIndex || 0) + 1}` : "",
      pts: a.measurements
    }));
  if (!rooms.length) return `<div class="no-ir">間取りデータがありません</div>`;

  const VW = 320, VH = 190, pad = 12, top = 18, gap = 1.2;
  const totalW = rooms.reduce((s, r) => s + r.W, 0) + gap * (rooms.length - 1);
  const maxD = Math.max(...rooms.map(r => r.D));
  const s = Math.min((VW - pad * 2) / totalW, (VH - pad - top) / maxD);

  let x0 = (VW - totalW * s) / 2, g = "";
  rooms.forEach(r => {
    const w = r.W * s, d = r.D * s;
    g += `<rect x="${x0}" y="${top}" width="${w}" height="${d}" fill="none" stroke="currentColor" stroke-width="2.5"/>`;
    for (let i = 1; i < r.W; i++) g += `<line x1="${x0 + i * s}" y1="${top}" x2="${x0 + i * s}" y2="${top + d}" stroke="currentColor" stroke-opacity=".15"/>`;
    for (let j = 1; j < r.D; j++) g += `<line x1="${x0}" y1="${top + j * s}" x2="${x0 + w}" y2="${top + j * s}" stroke="currentColor" stroke-opacity=".15"/>`;
    g += `<text x="${x0 + w / 2}" y="${top - 5}" text-anchor="middle" font-size="10" fill="currentColor">${esc(r.label)} ${esc(fmt(r.W))}×${esc(fmt(r.D))} m</text>`;
    r.pts.forEach(m => {
      if (!m.position) return;
      const cx = x0 + m.position.x * s, cy = top + m.position.y * s;
      g += `<circle cx="${cx}" cy="${cy}" r="9" style="fill:var(--accent)" stroke="#fff" stroke-width="1.5"/>`;
      g += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(m.pointIndex ?? "")}</text>`;
    });
    x0 += w + gap * s;
  });

  return `<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="部屋の間取り図と測定位置">${g}</svg>`;
}