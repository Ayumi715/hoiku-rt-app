import { db } from "./firebase-init.js";

const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const millis = m => (m.measuredAt && m.measuredAt.toMillis ? m.measuredAt.toMillis() : 0);

// facilities と measurements を読み込み、1カード=1部屋(凹凸は2エリア)にまとめる
export async function loadGroups() {
  const [fs, ms] = await Promise.all([
    db.collection("facilities").get(),
    db.collection("measurements").get()
  ]);

  const byFacility = {};
  ms.docs.forEach(d => {
    const m = { id: d.id, ...d.data() };
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
      uneven: areas.length > 1 || first.roomShape === "uneven",
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
  return groups.filter(g =>
    (!q.name || g.name.includes(q.name)) &&
    (!q.pref || g.prefecture === q.pref) &&
    (!q.city || g.city.includes(q.city)) &&
    (!q.use || g.areas.some(a => a.room.use === q.use &&
      (q.use !== "その他" || !q.useNote || (a.room.useNote || "").includes(q.useNote))))
  );
}