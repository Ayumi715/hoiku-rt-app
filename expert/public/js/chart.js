const COLORS = ["#0f766e", "#2563eb", "#c026d3", "#ea580c", "#65a30d", "#dc2626", "#0891b2", "#7c3aed", "#ca8a04"];

// 測定データの ir: { sampleRate, samples[] } を重ねて描画する(測定点ごとに色分け)
// 縦軸は保存した値の単位のまま。dB表示で保存する場合は軸ラベルを変更してください。
export function irSvg(measurements) {
  const list = measurements.filter(m => m.ir && Array.isArray(m.ir.samples) && m.ir.samples.length > 1 && m.ir.sampleRate > 0);
  if (!list.length) return `<div class="no-ir">IRデータがありません</div>`;

  const W = 420, H = 230, L = 46, R = 10, T = 12, B = 36;
  const tMax = Math.max(...list.map(m => m.ir.samples.length / m.ir.sampleRate));
  let lo = Infinity, hi = -Infinity;
  list.forEach(m => m.ir.samples.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; }));
  if (!(hi > lo)) hi = lo + 1;

  const x = t => L + (t / tMax) * (W - L - R);
  const y = v => T + ((hi - v) / (hi - lo)) * (H - T - B);

  let g = `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="none" stroke="currentColor" stroke-opacity=".3"/>`;
  for (let i = 0; i <= 4; i++) {
    const t = (tMax * i) / 4, px = x(t);
    g += `<line x1="${px}" y1="${T}" x2="${px}" y2="${H - B}" stroke="currentColor" stroke-opacity=".1"/>`;
    g += `<text x="${px}" y="${H - B + 14}" text-anchor="middle" font-size="10" fill="currentColor">${t.toFixed(2)}</text>`;
  }
  [lo, (lo + hi) / 2, hi].forEach(v => {
    g += `<text x="${L - 5}" y="${y(v) + 3}" text-anchor="end" font-size="10" fill="currentColor">${v.toFixed(2)}</text>`;
  });
  g += `<text x="${(L + W - R) / 2}" y="${H - 4}" text-anchor="middle" font-size="11" fill="currentColor">時間 (s)</text>`;
  g += `<text transform="translate(11 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor">振幅</text>`;

  list.forEach((m, i) => {
    const n = m.ir.samples.length, step = Math.max(1, Math.ceil(n / 800));
    const pts = [];
    for (let k = 0; k < n; k += step) pts.push(`${x(k / m.ir.sampleRate).toFixed(1)},${y(m.ir.samples[k]).toFixed(1)}`);
    g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="1" stroke-linejoin="round"/>`;
    if (list.length > 1) {
      g += `<text x="${W - R - 4}" y="${T + 12 + i * 12}" text-anchor="end" font-size="10" fill="${COLORS[i % COLORS.length]}">点${esc(m.pointIndex ?? i + 1)}</text>`;
    }
  });

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="インパルス応答のグラフ">${g}</svg>`;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));