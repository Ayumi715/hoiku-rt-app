const BOM = "\uFEFF";

// CSVの1セル。Excelで数式として実行されないよう、=,+,-,@ で始まる文字列は ' を付ける
const cell = v => {
  let s = v == null ? "" : v;
  if (typeof s === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  s = String(s);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = rows => BOM + rows.map(r => r.map(cell).join(",")).join("\r\n");

function save(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const dateStr = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
const when = m => (m.measuredAt && m.measuredAt.toDate ? m.measuredAt.toDate().toLocaleString("ja-JP") : "");

// 選択したグループを CSV で保存(測定点ごとに1行。IRがあれば別CSVも保存)
export function downloadGroups(groups) {
  if (!groups.length) return;

  const hzList = [...new Set(groups.flatMap(g => g.measurements.flatMap(m => (m.bands || []).map(b => b.hz))))].sort((a, b) => a - b);
  const head = [
    "施設ID", "施設名", "都道府県", "市区町村", "部屋グループID", "部屋", "用途", "用途(自由記述)",
    "奥行(m)", "幅(m)", "高さ(m)", "室容積(m3)", "直接音距離(m)",
    "測定ID", "測定点", "測定点x(m)", "測定点y(m)", "測定日時", "RT60(s)", "EDT(s)",
    ...hzList.flatMap(hz => [`RT60_${hz}Hz(s)`, `EDT_${hz}Hz(s)`])
  ];
  const rows = [head];
  const irRows = [["施設ID", "測定ID", "測定点", "サンプルレート(Hz)", "時間(s)", "値"]];

  groups.forEach(g => g.areas.forEach(a => a.measurements.forEach(m => {
    const bandOf = hz => (m.bands || []).find(b => b.hz === hz) || {};
    rows.push([
      a.id, a.name, a.prefecture, a.city, a.roomGroupId || "",
      g.uneven ? `部屋${(a.roomIndex || 0) + 1}` : "部屋", a.room.use, a.room.useNote,
      a.room.depth, a.room.width, a.room.height, a.volume, a.directDistance,
m.id, m.pointIndex,
(Array.isArray(m.position) ? m.position[0] : m.position)?.x,
(Array.isArray(m.position) ? m.position[0] : m.position)?.y,
when(m), m.rt60, m.edt,      ...hzList.flatMap(hz => [bandOf(hz).rt60, bandOf(hz).edt])
    ]);
    if (m.ir && Array.isArray(m.ir.samples)) {
      m.ir.samples.forEach((v, i) => irRows.push([a.id, m.id, m.pointIndex, m.ir.sampleRate, i / m.ir.sampleRate, v]));
    }
  })));

  const d = dateStr();
  save(`reverb_data_${d}.csv`, toCsv(rows));
  if (irRows.length > 1) setTimeout(() => save(`reverb_ir_${d}.csv`, toCsv(irRows)), 400);
}