export const volume = (w, d, h) => w * d * h;

// dc = 0.057 × √(V / 0.5)  (0.5 は推定残響時間の固定値)
export const directDistance = v => 0.057 * Math.sqrt(v / 0.5);

// 〜100m³:3点 / 100〜200m³:4〜5点 / 200m³〜:6点以上(最大9点)
export function pointCount(v) {
  if (v <= 100) return 3;
  if (v < 200) return v < 150 ? 4 : 5;
  return Math.min(6 + Math.floor((v - 200) / 100), 9);
}

// 部屋を行に分け、各行に点を均等配置(座標は左上原点・m単位)
export function layoutPoints(W, D, n) {
  const rows = Math.max(1, Math.min(n, Math.round(Math.sqrt(n * D / W))));
  const pts = [];
  for (let r = 0; r < rows; r++) {
    const cnt = Math.floor(n / rows) + (r < n % rows ? 1 : 0);
    for (let i = 0; i < cnt; i++) {
      pts.push({ x: (i + 0.5) / cnt * W, y: (r + 0.5) / rows * D });
    }
  }
  return pts;
}