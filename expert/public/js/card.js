import { irSvg } from "./chart.js";
import { planSvg, sectionsOf } from "./plan.js";
import { downloadGroups } from "./download.js";

const CHUNK = 10;
export const selected = new Map();   // 選択中: key -> group
let onSelect = () => {};
export const setSelectionHandler = f => { onSelect = f; };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const frag = html => { const t = document.createElement("template"); t.innerHTML = html; return t.content; };
const f2 = n => (Number.isFinite(n) ? n.toFixed(2) : "-");
const mean = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

function valBox(label, v) {
  const d = el("div", "val", label);
  d.append(el("b", null, `${f2(v)} 秒`));
  return d;
}

function bandTable(ms) {
  const acc = new Map();
  ms.forEach(m => (m.bands || []).forEach(b => {
    const e = acc.get(b.hz) || { n: 0, rt: 0, edt: 0 };
    e.n++; e.rt += b.rt60; e.edt += b.edt; acc.set(b.hz, e);
  }));
  const t = el("table", "bands");
  const hr = t.createTHead().insertRow();
  ["周波数", "RT60", "EDT"].forEach(h => hr.appendChild(el("th", null, h)));
  const tb = t.createTBody();
  [...acc].sort((a, b) => a[0] - b[0]).forEach(([hz, e]) => {
    const r = tb.insertRow();
    r.insertCell().textContent = `${hz} Hz`;
    r.insertCell().textContent = `${f2(e.rt / e.n)} 秒`;
    r.insertCell().textContent = `${f2(e.edt / e.n)} 秒`;
  });
  return t;
}

// 詳細表示用の「部屋」一覧を作る
function partsOf(g) {
  const parts = [];
  g.areas.forEach(a => {
    const secs = sectionsOf(a);
    const label = a.room.useNote || a.room.use || "用途なし";

    // 凹凸: 測定ごとの rooms[] を部屋1・部屋2に振り分ける
    if (secs.length > 1 && a.measurements.some(m => m.rooms && m.rooms.length)) {
      secs.forEach((c, i) => {
        const rs = a.measurements.map(m => (m.rooms || []).find(r => r.roomIndex === i)).filter(Boolean);
        parts.push({
          label, roomIndex: i,
          room: { width: c.width, depth: c.depth },
          ms: rs.map(r => ({
            ...r,
            position: r.position ? { x: r.position.x - c.x, y: r.position.y - c.y } : null  // 区画内の座標に直す
          }))
        });
      });
      return;
    }
    parts.push({ label, room: { ...a.room }, ms: a.measurements });
  });
  return parts;
}

// 凹凸の部屋: 部屋1・部屋2それぞれのデータ
function buildDetail(g) {
  const box = el("div", "detail");
  partsOf(g).forEach((p, i) => {
    const sec = el("section", "area");
    sec.append(el("h4", null, `部屋${i + 1}（${p.label}）`));
    if (!p.ms.length) {
      sec.append(el("p", "note", "この部屋の測定データがありません。"));
      box.append(sec);
      return;
    }
    const vals = el("div", "vals");
    vals.append(valBox("RT60", mean(p.ms.map(m => m.rt60))), valBox("EDT", mean(p.ms.map(m => m.edt))));
    const body = el("div", "card-body");
    const ir = el("div", "ir-box"); ir.append(frag(irSvg(p.ms)));
    const side = el("div", "side");
    const plan = el("div", "plan"); plan.append(frag(planSvg([{ room: p.room, measurements: p.ms }])));
    side.append(vals, plan);
    body.append(ir, side);
    sec.append(body, bandTable(p.ms));
    box.append(sec);
  });
  return box;
}

export function buildCard(g, { selectable = true } = {}) {
  const card = el("article", "card");

  const head = el("div", "card-head");
  if (selectable) {
    const cb = el("input", "sel");
    cb.type = "checkbox";
    cb.checked = selected.has(g.key);
    cb.setAttribute("aria-label", `${g.title} を選択`);
    cb.addEventListener("change", () => {
      if (cb.checked) selected.set(g.key, g); else selected.delete(g.key);
      onSelect();
    });
    head.append(cb);
  }
  head.append(el("h3", "card-title", g.title), el("div", "card-loc", `${g.prefecture} ${g.city}`));

  const body = el("div", "card-body");
  const ir = el("div", "ir-box"); ir.append(frag(irSvg(g.measurements)));
  const side = el("div", "side");
  const vals = el("div", "vals");
  vals.append(valBox("RT60", g.rt60), valBox("EDT", g.edt));
  const note = el("div", "note", `測定日 ${g.dateText} / ${g.measurements.length}点の平均`);
  const plan = el("div", "plan"); plan.append(frag(planSvg(g.areas)));
  side.append(vals, note, plan);
  body.append(ir, side);

  const foot = el("div", "card-foot");
  const dl = el("button", "btn small", "ダウンロード");
  dl.type = "button";
  dl.addEventListener("click", () => downloadGroups([g]));
  foot.append(dl);

  let detail = null;
  if (g.uneven) {
    const dt = el("button", "btn small secondary", "詳細");
    dt.type = "button";
    dt.setAttribute("aria-expanded", "false");
    dt.addEventListener("click", () => {
      if (!detail) { detail = buildDetail(g); card.insertBefore(detail, foot); }
      else detail.hidden = !detail.hidden;
      dt.setAttribute("aria-expanded", String(!detail.hidden));
    });
    foot.append(dt);
  }

  card.append(head, body, foot);
  return card;
}

// カードを CHUNK 件ずつ追加表示(下にスクロールすると続きが出る)。戻り値は後片付け用の関数
export function renderList(container, groups, opts) {
  container.replaceChildren();
  let shown = 0;
  const sentinel = el("div", "sentinel");
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: "400px" });

  function more() {
    groups.slice(shown, shown + CHUNK).forEach(g => container.insertBefore(buildCard(g, opts), sentinel));
    shown = Math.min(groups.length, shown + CHUNK);
    if (shown >= groups.length) { io.disconnect(); sentinel.remove(); }
  }

  container.append(sentinel);
  io.observe(sentinel);
  more();
  return () => io.disconnect();
}