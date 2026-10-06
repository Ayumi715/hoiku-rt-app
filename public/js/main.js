import { PREFECTURES, USES, NOTE_USES, CHECKLIST, SAMPLE } from "./config.js";
import { state, resetFlow, resetAll } from "./state.js";
import { volume, directDistance, pointCount, layoutPoints } from "./acoustics.js";
import { planSvg } from "./plan.js";
import { runMeasurement, DEMO } from "./measurement.js";
import { uploadMeasurement, loadHistory } from "./db.js";

const $ = id => document.getElementById(id);
const fmt = n => String(Math.round(n * 100) / 100);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

/* ---------- 画面遷移 ---------- */
const SCREENS = ["home", "history", "overview", "info", "checklist", "position", "measuring", "result", "help"];
const NEEDS_DATA = ["checklist", "position", "measuring", "result"];
let current = "home", helpReturn = "home", job = null, pending = null;

function show(id) {
  if (!SCREENS.includes(id) || (NEEDS_DATA.includes(id) && !state.ready)) id = "home";
  if (id === "result" && !state.results[state.activeIdx]) id = state.ready ? "position" : "home";
  if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  if (id === "help" && current !== "help") helpReturn = current;
  if (current === "measuring" && id !== "measuring" && job) job.cancelled = true;
  current = id;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  window.scrollTo(0, 0);
  if (id === "position") renderPosition();
  if (id === "measuring") startMeasurement();
  if (id === "result") renderResult();
  if (id === "history") renderHistory();
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

document.addEventListener("click", e => {
  const go = e.target.closest("[data-go]");
  if (!go || go.disabled) return;
  if (go.dataset.go === "home") requestHome();
  else location.hash = go.dataset.go;
});
$("helpBack").addEventListener("click", () => { location.hash = helpReturn; });

/* ---------- 確認ダイアログ ---------- */
let dlgBack = null, dlgAction = null;
function openDialog(msg, action, okLabel = "ホームに戻る") {
  $("dlgMsg").textContent = msg;
  $("dlgOk").textContent = okLabel;
  dlgAction = action || goHome;
  $("dialog").hidden = false;
  dlgBack = document.activeElement;
  $("dlgCancel").focus();
}
function closeDialog() { $("dialog").hidden = true; if (dlgBack && dlgBack.focus) dlgBack.focus(); }
$("dlgCancel").addEventListener("click", closeDialog);
$("dlgOk").addEventListener("click", () => { $("dialog").hidden = true; dlgAction(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("dialog").hidden) closeDialog(); });

function requestHome() {
  const unsent = Object.values(state.results).some(r => !r.uploaded);
  if (current === "measuring") openDialog("測定中です。測定を中止してホームに戻りますか?");
  else if (unsent) openDialog("まだアップロードされていない結果がありますがホームに戻りますか?");
  else goHome();
}
function goHome() {
  resetAll(); clearForm(); updateChecklist();
  location.hash = "home"; show("home");
}

/* ---------- P3 情報入力 ---------- */
PREFECTURES.forEach(p => $("pref").add(new Option(p, p)));
USES.forEach(u => $("use").add(new Option(u, u)));

function clearForm() {
  ["facility", "pref", "city",  "use", "useNote", "depth", "width", "height"].forEach(id => { $(id).value = ""; });
  $("useNoteWrap").hidden = true; $("planArea").hidden = true;
  $("err").textContent = ""; $("nextInfo").disabled = true;
}
function invalidate() {
  $("nextInfo").disabled = true;
  Object.assign(state, { ready: false, facilityId: null, results: {} });
}
const toHalf = s => s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/．/g, ".");
["depth", "width", "height"].forEach(id => {
  const input = $(id);
  const norm = () => { input.value = toHalf(input.value).replace(/[^\d.]/g, ""); };
  input.addEventListener("compositionend", norm);
  input.addEventListener("blur", norm);
});
document.querySelectorAll("#info input, #info select").forEach(x => x.addEventListener("input", invalidate));
$("use").addEventListener("change", () => { $("useNoteWrap").hidden = !NOTE_USES.includes($("use").value); });

function drawPlan() {
  const facility = $("facility").value.trim(), pref = $("pref").value, city = $("city").value.trim();
  const use = $("use").value, useNote = $("useNote").value.trim();
  const D = Number($("depth").value), W = Number($("width").value), H = Number($("height").value);

  let msg = "";
  if (!facility) msg = "施設名を入力してください。";
  else if (!pref) msg = "県を選択してください。";
  else if (!city) msg = "市町村を入力してください。";
  else if (!use) msg = "部屋の用途を選択してください。";
  else if (use === "その他" && !useNote) msg = "部屋の用途を自由記述欄に入力してください。";
  else if (!(D > 0 && W > 0 && H > 0)) msg = "奥行・幅・高さを0より大きい数値で入力してください。";
  else if (D > 50 || W > 50 || H > 20) msg = "寸法が大きすぎます。単位がメートルか確認してください。";
  $("err").textContent = msg;
  if (msg) { invalidate(); return; }

  const V = volume(W, D, H);
  Object.assign(state, {
    ready: true, facility, pref, city, use, useNote,
    depth: D, width: W, height: H, volume: V, dc: directDistance(V),
    points: layoutPoints(W, D, pointCount(V)), activeIdx: 0, results: {}, facilityId: null
  });
  $("plan").innerHTML = planSvg(W, D);
  $("sArea").textContent = fmt(W * D) + " ㎡";
  $("sVol").textContent = fmt(V) + " ㎥";
  $("sPer").textContent = fmt(2 * (W + D)) + " m";
  $("planArea").hidden = false;
  $("nextInfo").disabled = false;
  $("planArea").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("drawBtn").addEventListener("click", drawPlan);

$("fillSample").addEventListener("click", () => {
  Object.entries(SAMPLE).forEach(([k, v]) => { $(k).value = v; });
  $("useNoteWrap").hidden = !NOTE_USES.includes(SAMPLE.use);
  drawPlan();
});

/* ---------- P4 チェックリスト ---------- */
CHECKLIST.forEach((text, i) => {
  const label = el("label", null, "check-item");
  const span = el("span", text);
  const box = document.createElement("input");
  box.type = "checkbox"; box.id = "chk" + i;
  label.append(span, box);
  $("checkList").appendChild(label);
});
function updateChecklist() {
  const boxes = [...document.querySelectorAll("#checkList input")];
  const n = boxes.filter(b => b.checked).length;
  boxes.forEach(b => b.closest(".check-item").classList.toggle("checked", b.checked));
  $("checkCount").textContent = `${n} / ${boxes.length} 確認済み`;
  $("nextCheck").disabled = n !== boxes.length;
}
$("checkList").addEventListener("change", updateChecklist);
$("checkAll").addEventListener("click", () => {
  document.querySelectorAll("#checkList input").forEach(b => { b.checked = true; });
  updateChecklist();
});
updateChecklist();

/* ---------- P5 測定位置・ガイド ---------- */
function renderPosition() {
  const doneIdx = Object.keys(state.results).map(Number);
  $("planPos").innerHTML = planSvg(state.width, state.depth, { points: state.points, active: state.activeIdx, done: doneIdx });
  $("pVol").textContent = fmt(state.volume) + " ㎥";
  $("pDc").textContent = fmt(state.dc) + " m";
  $("pN").textContent = state.points.length + " 点";
  const p = state.points[state.activeIdx];
  $("posNote").textContent =
    `測定点 ${state.activeIdx + 1} / ${state.points.length}(図の番号をタップすると切り替えられます。塗りつぶしは測定済み)。` +
    `左の壁から ${fmt(p.x)} m、上の壁から ${fmt(p.y)} m の位置に立ってください。`;
}
$("planPos").addEventListener("click", e => {
  const g = e.target.closest("[data-point]");
  if (!g) return;
  state.activeIdx = Number(g.dataset.point);
  renderPosition();
});

/* ---------- P6 測定 ---------- */
function startMeasurement() {
  $("measureErr").textContent = "";
  $("measureNext").disabled = false;
  const c = job = { cancelled: false };
  const idx = state.activeIdx;
  pending = runMeasurement(c).then(res => {
    if (c.cancelled) return false;
    state.results[idx] = { ...res, measuredAt: new Date(), uploaded: false };
    return true;
  }).catch(err => { if (!c.cancelled) console.error(err); return false; });
}
$("measureNext").addEventListener("click", async () => {
  $("measureNext").disabled = true;
  const ok = await pending;
  if (current !== "measuring") return;
  if (ok) location.hash = "result";
  else { $("measureErr").textContent = "測定に失敗しました。戻ってもう一度お試しください。"; $("measureNext").disabled = false; }
});

/* ---------- P7 結果 ---------- */
function renderResult() {
  const r = state.results[state.activeIdx];
  $("resMeta").textContent =
    `${state.facility}(${state.pref}${state.city})/ ${state.use}${state.useNote ? "(" + state.useNote + ")" : ""} / ` +
    `測定点 ${state.activeIdx + 1} / ${r.measuredAt.toLocaleString("ja-JP")}`;
  $("resRt").textContent = fmt(r.rt60) + " 秒";
  $("resEdt").textContent = fmt(r.edt) + " 秒";
  $("demoNote").hidden = !DEMO;
  $("uploadErr").textContent = "";
  updateUploadUI();
}
function updateUploadUI() {
  const r = state.results[state.activeIdx];
  $("uploadBtn").disabled = r.uploaded;
  $("uploadBtn").textContent = r.uploaded ? "アップロード済み" : "結果をアップロード";
  $("uploadMsg").textContent = r.uploaded ? "✓ 結果をアップロードしました。" : "";
}
$("uploadBtn").addEventListener("click", async () => {
  const idx = state.activeIdx;
  $("uploadBtn").disabled = true;
  $("uploadBtn").textContent = "アップロード中…";
  $("uploadErr").textContent = "";
  try {
    await uploadMeasurement(state, idx);
    state.results[idx].uploaded = true;
  } catch (err) {
    console.error(err);
    $("uploadErr").textContent = "アップロードに失敗しました。通信状況を確認して、もう一度お試しください。";
  }
  if (current === "result" && state.activeIdx === idx) updateUploadUI();
});
// 同じ場所でやり直す(同じ測定点)
$("redoBtn").addEventListener("click", () => {
  delete state.results[state.activeIdx];
  location.hash = "position";
});
// 別の場所で測定: 施設名・県・市町村は残し、人数・部屋の情報は空にして P3 へ
$("otherBtn").addEventListener("click", () => {
  if (Object.values(state.results).some(r => !r.uploaded)) {
    openDialog("まだアップロードされていない結果がありますが、別の場所の測定に進みますか?", () => {
      goOtherPlace();
    }, "進む");
    return;
  }
  goOtherPlace();
});

function goOtherPlace() {
  ["use", "useNote", "depth", "width", "height"].forEach(id => { $(id).value = ""; });
  $("useNoteWrap").hidden = true;
  $("planArea").hidden = true;
  $("err").textContent = "";
  $("nextInfo").disabled = true;
  document.querySelectorAll("#checkList input").forEach(b => { b.checked = false; });
  updateChecklist();
  resetFlow();
  location.hash = "info";
}

/* ---------- 今までの結果 ---------- */
async function renderHistory() {
  const st = $("historyStatus"), list = $("historyList");
  st.textContent = "保存した結果を読み込み中…";
  list.replaceChildren();
  try {
    const items = await loadHistory();
    if (!items.length) { st.textContent = "この端末では、まだアップロード済みの測定結果がありません。"; return; }
    st.textContent = `${items.length}件の施設`;
    items.forEach(f => list.appendChild(historyCard(f)));
  } catch (e) {
    console.error(e);
    st.textContent = "結果を読み込めませんでした。通信状況を確認して、再読み込みしてください。";
  }
}
function historyCard(f) {
  const c = el("article", null, "card");
  const use = f.room.use + (f.room.useNote ? `(${f.room.useNote})` : "");
  c.append(
    el("h3", f.name),
    el("p", `${f.prefecture}${f.city} / ${use}`, "meta"),
    el("p", `室容積 ${fmt(f.volume)} ㎥`, "meta")
  );
  f.measurements.forEach(m => {
    const row = el("p", null, "row");
    row.append(el("span", `測定点${m.pointIndex}(${m.measuredAt.toDate().toLocaleDateString("ja-JP")})`), el("strong", `RT60 ${fmt(m.rt60)} 秒`));
    c.append(row);
  });
  return c;
}
$("historyReload").addEventListener("click", renderHistory);

/* ---------- 起動 ---------- */
show(location.hash.slice(1));