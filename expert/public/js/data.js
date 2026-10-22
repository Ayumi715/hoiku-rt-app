import { db } from "./firebase-init.js";
import { sectionsOf } from "./plan.js";
import { ROOM_VOLUME_RANGES } from "./config.js";

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const millis = m => (m.measuredAt && m.measuredAt.toMillis ? m.measuredAt.toMillis() : 0);

// 1件の measurements を「部屋ごとの測定」に分解して正規化する
//  - 凹凸(isConcaveBundle): resultSets の room1/room2 と position[roomIndex] に分ける
//  - 長方形: そのまま1件(position はオブジェクト)
export function normalizeMeasurement(m) {
  const sets = Array.isArray(m.resultSets) ? m.resultSets : [];
  const positions = Array.isArray(m.position) ? m.position : (m.position ? [m.position] : []);
  const irOf = s => (s && Array.isArray(s.ir) ? { sampleRate: s.sampleRate, samples: s.ir } : null);

  if (m.isConcaveBundle || sets.length) {
    const avg = sets.find(s => s.key === "average");
    const rooms = ["room1", "room2"].map((key, i) => {
      const s = sets.find(x => x.key === key);
      if (!s) return null;
      return {
        roomIndex: i,
        rt60: s.rt60, edt: s.edt, bands: s.bands || [], valid: s.valid, r2: s.r2,
        ir: irOf(s),
        position: positions.find(p => (p.roomIndex ?? 0) === i) || null,
        pointIndex: m.pointIndex, id: m.id, measuredAt: m.measuredAt
      };
    }).filter(Boolean);
    return {
      ...m,
      rt60: avg ? avg.rt60 : m.rt60,
      edt: avg ? avg.edt : m.edt,
      bands: avg ? avg.bands : m.bands,
      ir: irOf(avg),
      rooms,
      position: null
    };
  }

  // 長方形(旧形式・新形式の両対応)
  const ir = m.ir && Array.isArray(m.ir.samples) ? m.ir
    : (Array.isArray(m.ir) ? { sampleRate: m.sampleRate, samples: m.ir } : null);
  return { ...m, ir, rooms: [], position: positions[0] || null };
}

// facilities と measurements を読み込み、1カード=1部屋(凹凸は1件にまとまっている)にする
export async function loadGroups() {
  const [fs, ms] = await Promise.all([
    db.collection("facilities").get(),
    db.collection("measurements").get()
  ]);

  const byFacility = {};
  ms.docs.forEach(d => {
    const m = normalizeMeasurement({ id: d.id, ...d.data() });
    (byFacility[m.facilityId] ||= []).push(m);
  });

  const groups = {};
  fs.docs.forEach(d => {
    const f = { id: d.id, ...d.data() };
    const measurements = (byFacility[d.id] || []).sort((a, b) => (a.pointIndex || 0) - (b.pointIndex || 0));
    if (!measurements.length) return;
    const area = {
      ...f, room: f.room || {}, measurements,
      rt60: mean(measurements.map(m => m.rt60)),
      edt: mean(measurements.map(m => m.edt))
    };
    (groups[f.roomGroupId || d.id] ||= []).push(area);
  });

  return Object.entries(groups).map(([key, areas]) => {
    areas.sort((a, b) => (a.roomIndex || 0) - (b.roomIndex || 0));
    const first = areas[0];
    const all = areas.flatMap(a => a.measurements);
    const latest = Math.max(...all.map(millis));
    const roomName = (first.room.useNote || first.room.use || "");
    return {
      key, areas, measurements: all,
      uneven: areas.length > 1 || sectionsOf(first).length > 1 || first.room.shape === "concave",
      name: first.name || "",
      prefecture: first.prefecture || "",
      city: first.city || "",
      title: `${first.name || "施設名なし"}（${roomName || "用途なし"}）`,
      rt60: mean(all.map(m => m.rt60)),
      edt: mean(all.map(m => m.edt)),
      latest,
      dateText: latest ? new Date(latest).toLocaleDateString("ja-JP") : "不明"
    };
  });
}

export function sortGroups(groups, order) {
  const sign = order === "asc" ? 1 : -1;
  return [...groups].sort((a, b) => sign * (a.latest - b.latest));
}

// 指定された条件をすべて満たす(AND)グループだけ返す
export function filterGroups(groups, q) {
  const volumeRange = ROOM_VOLUME_RANGES.find(range => range.value === q.volume);
  return groups.filter(g =>
    (!q.name || g.name.includes(q.name)) &&
    (!q.pref || g.prefecture === q.pref) &&
    (!q.city || g.city.includes(q.city)) &&
    ((!q.use && !volumeRange) || g.areas.some(a =>
      (!q.use || (a.room.use === q.use &&
        (q.use !== "その他" || !q.useNote || (a.room.useNote || "").includes(q.useNote)))) &&
      (!volumeRange || (Number.isFinite(a.volume) &&
        a.volume >= volumeRange.min && a.volume < volumeRange.max))))
  );
}