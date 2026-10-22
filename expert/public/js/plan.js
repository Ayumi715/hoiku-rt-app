const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = n => String(Math.round(n * 100) / 100);

// 区画(sections)があればそれを、なければ room 全体を1つの長方形として扱う
export const sectionsOf = a => {
  const r = a.room || {};
  if (Array.isArray(r.sections) && r.sections.length) {
    return r.sections.map(s => ({ x: +s.x || 0, y: +s.y || 0, width: +s.width, depth: +s.depth }));
  }
  return [{ x: 0, y: 0, width: +r.width, depth: +r.depth }];
};

// 測定から描画する点を取り出す(凹凸は rooms[].position、長方形は position)
function pointsOf(measurements) {
  const pts = [];
  (measurements || []).forEach(m => {
    if (m.rooms && m.rooms.length) {
      m.rooms.forEach(r => { if (r.position) pts.push({ x: r.position.x, y: r.position.y, label: `${m.pointIndex ?? ""}` }); });
    } else if (m.position && Number.isFinite(m.position.x)) {
      pts.push({ x: m.position.x, y: m.position.y, label: `${m.pointIndex ?? ""}` });
    }
  });
  return pts;
}

// areas: facilities由来の配列。区画の位置どおりに描画し、測定点も重ねる(1m升目つき)
export function planSvg(areas) {
  const rooms = areas.map(a => {
    const secs = sectionsOf(a).filter(s => s.width > 0 && s.depth > 0);
    if (!secs.length) return null;
    return {
      secs,
      W: Math.max(...secs.map(s => s.x + s.width)),
      D: Math.max(...secs.map(s => s.y + s.depth)),
      pts: pointsOf(a.measurements)
    };
  }).filter(Boolean);
  if (!rooms.length) return `<div class="no-ir">間取りデータがありません</div>`;

  const VW = 320, VH = 190, pad = 12, top = 16, gap = 1.2;
  const totalW = rooms.reduce((s, r) => s + r.W, 0) + gap * (rooms.length - 1);
  const maxD = Math.max(...rooms.map(r => r.D));
  const s = Math.min((VW - pad * 2) / totalW, (VH - pad - top) / maxD);

  let ox = (VW - totalW * s) / 2, g = "";
  rooms.forEach(r => {
    // 壁: 太い線で全区画を描き、内側を塗りで覆う(区画の境目の線は消え、外周だけが残る)
    r.secs.forEach(c => {
      g += `<rect x="${ox + c.x * s}" y="${top + c.y * s}" width="${c.width * s}" height="${c.depth * s}" fill="var(--panel)" stroke="currentColor" stroke-width="6" stroke-linejoin="round"/>`;
    });
    r.secs.forEach(c => {
      g += `<rect x="${ox + c.x * s}" y="${top + c.y * s}" width="${c.width * s}" height="${c.depth * s}" fill="var(--panel)"/>`;
    });
    // 1mごとの升目(区画の内側だけ)
    r.secs.forEach(c => {
      for (let m = Math.floor(c.x) + 1; m < c.x + c.width; m++) {
        g += `<line x1="${ox + m * s}" y1="${top + c.y * s}" x2="${ox + m * s}" y2="${top + (c.y + c.depth) * s}" stroke="currentColor" stroke-opacity=".15"/>`;
      }
      for (let m = Math.floor(c.y) + 1; m < c.y + c.depth; m++) {
        g += `<line x1="${ox + c.x * s}" y1="${top + m * s}" x2="${ox + (c.x + c.width) * s}" y2="${top + m * s}" stroke="currentColor" stroke-opacity=".15"/>`;
      }
    });
    // 寸法ラベル
    if (r.secs.length > 1) {
      r.secs.forEach((c, i) => {
        g += `<text x="${ox + (c.x + c.width / 2) * s}" y="${top + c.y * s + 12}" text-anchor="middle" font-size="9" fill="currentColor" fill-opacity=".7">部屋${i + 1} ${esc(fmt(c.width))}×${esc(fmt(c.depth))} m</text>`;
      });
    } else {
      const c = r.secs[0];
      g += `<text x="${ox + c.width * s / 2}" y="${top - 4}" text-anchor="middle" font-size="10" fill="currentColor">${esc(fmt(c.width))}×${esc(fmt(c.depth))} m</text>`;
    }
    // 測定点(部屋全体の座標、左上原点)
    r.pts.forEach(p => {
      const cx = ox + p.x * s, cy = top + p.y * s;
      g += `<circle cx="${cx}" cy="${cy}" r="9" style="fill:var(--accent)" stroke="#fff" stroke-width="1.5"/>`;
      g += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(p.label)}</text>`;
    });
    ox += (r.W + gap) * s;
  });

  return `<svg viewBox="0 0 ${VW} ${VH}" role="img" aria-label="部屋の間取り図と測定位置">${g}</svg>`;
}