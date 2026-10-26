const COLORS = ["#0f766e", "#2563eb", "#c026d3", "#ea580c", "#65a30d", "#dc2626", "#0891b2", "#7c3aed", "#ca8a04"];
const LEGACY_IR_DURATION = 0.9;

// 旧形式(ir=配列 + sampleRate)と新形式(ir={sampleRate,samples})の両方に対応
function irOf(m) {
  if (m.ir && Array.isArray(m.ir.samples)) {
    const { samples, sampleRate } = m.ir;
    if (sampleRate > 4000 && samples.length <= 800) return { sampleRate: samples.length / LEGACY_IR_DURATION, samples };
    return m.ir;
  }
  if (Array.isArray(m.ir) && m.sampleRate > 0) {
    if (m.sampleRate > 4000 && m.ir.length <= 800) return { sampleRate: m.ir.length / LEGACY_IR_DURATION, samples: m.ir };
    return { sampleRate: m.sampleRate, samples: m.ir };
  }
  return null;
}

export function irSvg(measurements) {
  const list = measurements
    .map(m => ({ m, ir: irOf(m) }))
    .filter(x => x.ir && x.ir.samples.length > 1 && x.ir.sampleRate > 0);
  if (!list.length) return `<div class="no-ir">IRデータがありません</div>`;

  const W = 420, H = 250, L = 62, R = 10, T = 14, B = 44;
  const tMax = 0.05;

  const x = t => L + (t / tMax) * (W - L - R);
  const y = v => T + ((1 - v) / 2) * (H - T - B);

  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="currentColor" stroke-opacity=".3"/>`;
  for (let i = 0; i <= 10; i++) {
    const t = i * 0.005, px = x(t);
    g += `<line x1="${px}" y1="${T}" x2="${px}" y2="${H - B}" stroke="currentColor" stroke-opacity=".1"/>`;
    g += `<text x="${px}" y="${H - B + 13}" text-anchor="middle" font-size="8" fill="currentColor">${t.toFixed(3)}</text>`;
  }
  [[1, "1.0"], [0.5, "0.5"], [0, "0"], [-0.5, "-0.5"], [-1, "-1.0"]].forEach(([v, label]) => {
    const py = y(v);
    g += `<line x1="${L}" y1="${py}" x2="${W - R}" y2="${py}" stroke="currentColor" stroke-opacity=".15"/>`;
    g += `<text x="${L - 8}" y="${py + 3}" text-anchor="end" font-size="10" fill="currentColor">${label}</text>`;
  });
  g += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="currentColor">時間 (s)</text>`;
  g += `<text transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor">振幅</text>`;

  list.forEach(({ m, ir }, i) => {
    const n = ir.samples.length, step = Math.max(1, Math.ceil(n / 800));
    const last = Math.min(n - 1, Math.floor(tMax * ir.sampleRate));
    const pts = [];
    for (let k = 0; k <= last; k += step) pts.push(`${x(k / ir.sampleRate).toFixed(1)},${y(ir.samples[k]).toFixed(1)}`);
    if (last > 0 && last % step !== 0) pts.push(`${x(last / ir.sampleRate).toFixed(1)},${y(ir.samples[last]).toFixed(1)}`);
    g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="1" stroke-linejoin="round"/>`;
    if (list.length > 1) {
      g += `<text x="${W - R - 4}" y="${T + 12 + i * 12}" text-anchor="end" font-size="10" fill="${COLORS[i % COLORS.length]}">点${esc(m.pointIndex ?? i + 1)}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="インパルス応答のグラフ">${g}</svg>`;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));