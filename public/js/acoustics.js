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

export function layoutPointsInSections(sections, n) {
  if (sections.length === 1) {
    const section = sections[0];
    return layoutPoints(section.width, section.depth, n).map(p => ({
      ...p, x: p.x + section.x, y: p.y + section.y, roomIndex: 0, localX: p.x, localY: p.y
    }));
  }

  const [first, second] = sections;
  const firstArea = first.width * first.depth;
  const totalArea = firstArea + second.width * second.depth;
  const firstCount = Math.max(1, Math.min(n - 1, Math.round(n * firstArea / totalArea)));
  return sections.flatMap((section, index) =>
    layoutPoints(section.width, section.depth, index === 0 ? firstCount : n - firstCount)
      .map(p => ({
        ...p,
        x: p.x + section.x,
        y: p.y + section.y,
        roomIndex: index,
        localX: p.x,
        localY: p.y
      }))
  );
}

export function roomCenter(sections) {
  const area = sections.reduce((total, section) => total + section.width * section.depth, 0);
  return sections.reduce((center, section) => {
    const sectionArea = section.width * section.depth;
    return {
      x: center.x + (section.x + section.width / 2) * sectionArea / area,
      y: center.y + (section.y + section.depth / 2) * sectionArea / area
    };
  }, { x: 0, y: 0 });
}

export function averageMeasurements(trials) {
  const average = key => trials.reduce((total, trial) => total + trial[key], 0) / trials.length;
  const averageArray = key => trials[0][key].map((_, i) =>
    trials.reduce((total, trial) => total + trial[key][i], 0) / trials.length
  );
  const rt60 = average("rt60");
  const r2 = average("r2");
  return {
    ...trials[trials.length - 1],
    rt60,
    edt: average("edt"),
    r2,
    valid: r2 > 0.8,
    ir: averageArray("ir"),
    edc: averageArray("edc"),
    bands: trials[0].bands.map((band, i) => ({
      hz: band.hz,
      rt60: trials.reduce((total, trial) => total + trial.bands[i].rt60, 0) / trials.length,
      edt: trials.reduce((total, trial) => total + trial.bands[i].edt, 0) / trials.length
    })),
    trials,
    uploaded: false
  };
}