import { PREFECTURES, USES, NOTE_USES, CHECKLIST, SAMPLE } from "./config.js";
import { state, resetFlow, resetAll } from "./state.js";
import { averageMeasurements, directDistance, roomCenter } from "./acoustics.js";
import { planSvg } from "./plan.js";
import { openMicrophone, playTspPreview, runMeasurement, DEMO, MEASUREMENT_SETTINGS } from "./measurement.js";
import { uploadConcaveMeasurements, uploadMeasurement, loadHistory } from "./db.js";

const $ = id => document.getElementById(id);
const fmt = n => String(Math.round((n + Number.EPSILON) * 100) / 100);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };

/* ---------- 画面遷移 ---------- */
const SCREENS = ["home", "history", "overview", "info", "checklist", "position", "measuring", "result", "help"];
const NEEDS_DATA = ["checklist", "position", "measuring", "result"];
let current = "home", helpReturn = "home", job = null;
let audioSession = null, microphonePromise = null, microphonePromiseGeneration = -1, microphoneGeneration = 0;
let lastSaveNameIndex = -1;
let redoMode = false, redoRoomSelected = false;

function show(id) {
  if (!SCREENS.includes(id) || (NEEDS_DATA.includes(id) && !state.ready)) id = "home";
  if (id === "result" && !state.results[state.activeIdx]) id = state.ready ? "position" : "home";
  if (id === "checklist") resetChecklist();
  if (location.hash.slice(1) !== id) history.replaceState(null, "", "#" + id);
  if (id === "help" && current !== "help") helpReturn = current;
  if (current === "measuring" && id !== "measuring") {
    if (job) job.cancelled = true;
    releaseMicrophone();
  }
  current = id;
  document.querySelectorAll(".screen").forEach(s => s.classList.toggle("active", s.id === id));
  window.scrollTo(0, 0);
  if (id === "position") renderPosition();
  if (id === "measuring") setupMeasurement();
  if (id === "result") renderResult();
  if (id === "history") renderHistory();
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
window.addEventListener("pageshow", () => {
  if (current === "checklist") resetChecklist();
});

document.addEventListener("click", e => {
  const go = e.target.closest("[data-go]");
  if (!go || go.disabled) return;
  if (go.dataset.go === "home") requestHome();
  else if (go.dataset.go === "measuring" && current === "position") {
    show("measuring");
    if (current === "measuring") void beginMeasurement();
  }
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
  const unsent = Object.values(state.results).some(r => !r.uploaded) ||
    Object.entries(state.trials).some(([idx, trials]) => trials.length > 0 && !state.results[idx]);
  if (current === "measuring") openDialog("測定中です。測定を中止してホームに戻りますか?");
  else if (unsent) openDialog("まだアップロードされていない結果がありますがホームに戻りますか?");
  else goHome();
}
function goHome() {
  redoMode = false;
  redoRoomSelected = false;
  resetAll(); clearForm(); resetChecklist();
  location.hash = "home"; show("home");
}

/* ---------- P3 情報入力 ---------- */
PREFECTURES.forEach(p => $("pref").add(new Option(p, p)));
USES.forEach(u => $("use").add(new Option(u, u)));

function clearForm() {
  lastSaveNameIndex = -1;
  ["facility", "pref", "city", "use", "useNote", "depth", "width", "depth1", "width1", "depth2", "width2", "height"].forEach(id => { $(id).value = ""; });
  document.querySelector('input[name="roomShape"][value="rectangular"]').checked = true;
  updateRoomShape();
  $("useNoteWrap").hidden = true; $("planArea").hidden = true;
  $("err").textContent = ""; $("nextInfo").disabled = true;
}
function invalidate() {
  redoMode = false;
  redoRoomSelected = false;
  $("nextInfo").disabled = true;
  Object.assign(state, { ready: false, facilityId: null, trials: {}, results: {} });
}
const toHalf = s => s.replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/．/g, ".");
["depth", "width", "depth1", "width1", "depth2", "width2", "height"].forEach(id => {
  const input = $(id);
  const norm = () => { input.value = toHalf(input.value).replace(/[^\d.]/g, ""); };
  input.addEventListener("compositionend", norm);
  input.addEventListener("blur", norm);
});
document.querySelectorAll("#info input, #info select").forEach(x => x.addEventListener("input", invalidate));
function updateRoomShape() {
  const isConcave = document.querySelector('input[name="roomShape"]:checked').value === "concave";
  $("rectRoomFields").hidden = isConcave;
  $("concaveRoomFields").hidden = !isConcave;
}
document.querySelectorAll('input[name="roomShape"]').forEach(input => input.addEventListener("change", updateRoomShape));
$("use").addEventListener("change", () => { $("useNoteWrap").hidden = !NOTE_USES.includes($("use").value); });

function drawPlan() {
  redoMode = false;
  redoRoomSelected = false;
  const facility = $("facility").value.trim(), pref = $("pref").value, city = $("city").value.trim();
  const use = $("use").value, useNote = $("useNote").value.trim();
  const roomShape = document.querySelector('input[name="roomShape"]:checked').value;
  const H = Number($("height").value);
  const dimensions = roomShape === "concave"
    ? [Number($("depth1").value), Number($("width1").value), Number($("depth2").value), Number($("width2").value)]
    : [Number($("depth").value), Number($("width").value)];
  const [D1, W1, D2, W2] = dimensions;
  const D = roomShape === "concave" ? Math.max(D1 || 0, D2 || 0) : dimensions[0];
  const W = roomShape === "concave" ? W1 + W2 : dimensions[1];
  const sections = roomShape === "concave"
    ? [
        { x: 0, y: D - D1, width: W1, depth: D1 },
        { x: W1, y: D - D2, width: W2, depth: D2 }
      ]
    : [{ x: 0, y: 0, width: W, depth: D }];
  const area = roomShape === "concave" ? W1 * D1 + W2 * D2 : W * D;

  let msg = "";
  if (!facility) msg = "施設名を入力してください。";
  else if (!pref) msg = "県を選択してください。";
  else if (!city) msg = "市町村を入力してください。";
  else if (!use) msg = "部屋の用途を選択してください。";
  else if (use === "その他" && !useNote) msg = "部屋の用途を自由記述欄に入力してください。";
  else if (dimensions.some(value => !(value > 0)) || !(H > 0)) msg = roomShape === "concave"
    ? "2部屋分の奥行・幅と高さを0より大きい数値で入力してください。"
    : "奥行・幅・高さを0より大きい数値で入力してください。";
  else if (roomShape === "concave" && D1 === D2) msg = "入力した奥行では凹凸型になりません。長方形型を選ぶか、寸法を確認してください。";
  else if (D > 50 || W > 50 || dimensions.some(value => value > 50) || H > 20) msg = "寸法が大きすぎます。単位がメートルか確認してください。";
  $("err").textContent = msg;
  if (msg) { invalidate(); return; }

  const V = area * H;
  const points = roomShape === "concave"
    ? sections.map((section, roomIndex) => ({
        x: section.x + section.width / 2,
        y: section.y + section.depth / 2,
        roomIndex
      }))
    : [roomCenter(sections)];
  Object.assign(state, {
    ready: true, facility, pref, city, use, useNote,
    roomShape, sections,
    depth: D, width: W, height: H, volume: V, dc: directDistance(V),
    points, activeIdx: 0, trials: {}, results: {}, facilityId: null
  });
  $("plan").innerHTML = planSvg(W, D, { sections });
  $("sDims").textContent = roomShape === "concave"
    ? `部屋1: 奥行 ${fmt(D1)} m × 幅 ${fmt(W1)} m ／ 部屋2: 奥行 ${fmt(D2)} m × 幅 ${fmt(W2)} m（共通高さ ${fmt(H)} m）`
    : `奥行 ${fmt(D)} m × 幅 ${fmt(W)} m × 高さ ${fmt(H)} m`;
  $("planArea").hidden = false;
  $("nextInfo").disabled = false;
  $("planArea").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
$("drawBtn").addEventListener("click", drawPlan);

$("fillSample").addEventListener("click", () => {
  Object.entries(SAMPLE).forEach(([k, v]) => { $(k).value = v; });
  document.querySelector('input[name="roomShape"][value="rectangular"]').checked = true;
  updateRoomShape();
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
function resetChecklist() {
  document.querySelectorAll("#checkList input").forEach(box => { box.checked = false; });
  updateChecklist();
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
  const isConcave = state.roomShape === "concave";
  $("planPos").innerHTML = planSvg(state.width, state.depth, {
    points: state.points,
    active: isConcave && redoMode && !redoRoomSelected ? -1 : state.activeIdx,
    done: doneIdx,
    sections: state.sections,
    selectable: isConcave && redoMode
  });
  if (state.roomShape === "concave") {
    $("positionTitle").textContent = redoMode
      ? redoRoomSelected
        ? `部屋${state.activeIdx + 1}の再測定位置`
        : "再測定する部屋を選択"
      : `部屋${state.activeIdx + 1}の測定位置`;
    $("posNote").textContent = redoMode
      ? redoRoomSelected
        ? `部屋${state.activeIdx + 1}を再測定します。`
        : "間取り図の部屋番号をタップして、再測定する部屋を選んでください。"
      : `部屋${state.activeIdx + 1}の中央で測定します。部屋1・2をそれぞれ1回測定します。`;
    $("startMeasureBtn").disabled = redoMode && !redoRoomSelected;
    $("startMeasureBtn").textContent = redoMode
      ? `部屋${state.activeIdx + 1}を再測定`
      : `部屋${state.activeIdx + 1}を測定`;
  } else {
    $("positionTitle").textContent = "測定位置";
    $("posNote").textContent = "部屋の中央に立ってください。";
    $("startMeasureBtn").disabled = false;
    $("startMeasureBtn").textContent = "測定開始";
  }
}
$("planPos").addEventListener("click", e => {
  if (state.roomShape !== "concave" || !redoMode) return;
  const g = e.target.closest("[data-point]");
  if (!g) return;
  const idx = Number(g.dataset.point);
  state.activeIdx = idx;
  redoRoomSelected = true;
  renderPosition();
});

$("previewTspBtn").addEventListener("click", async () => {
  const button = $("previewTspBtn");
  const status = $("previewTspStatus");
  button.disabled = true;
  status.textContent = "TSPを1回再生しています。";
  try {
    await playTspPreview();
    status.textContent = "試聴が完了しました。";
  } catch (error) {
    console.error(error);
    status.textContent = error.message || "試聴を再生できませんでした。";
  } finally {
    button.disabled = false;
  }
});

/* ---------- P6 測定 ---------- */
function releaseMicrophone() {
  microphoneGeneration++;
  const session = audioSession;
  audioSession = null;
  if (session) session.stop().catch(error => console.error("マイクの終了に失敗しました。", error));
}

function showInputLevel(dbfs) {
  if (current !== "measuring") return;
  $("levelValue").textContent = dbfs.toFixed(1);
  $("levelFill").style.width = `${((dbfs + 60) / 60) * 100}%`;
  $("levelFill").parentElement.setAttribute("aria-valuenow", String(Math.round(dbfs)));
}

function microphoneError(error) {
  console.error(error);
  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "マイクの使用が許可されていません。ブラウザーのサイト設定からマイクを許可してください。";
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return "マイクが見つかりません。マイクを接続してから再試行してください。";
  }
  return error.message || "マイクを開始できませんでした。";
}

function ensureMicrophone(generation = microphoneGeneration) {
  if (audioSession) return Promise.resolve(audioSession);
  if (microphonePromise && microphonePromiseGeneration === generation) return microphonePromise;
  if (!microphonePromise || microphonePromiseGeneration !== generation) {
    const opening = openMicrophone(showInputLevel).then(async session => {
      if (generation !== microphoneGeneration || current !== "measuring") {
        await session.stop();
        return null;
      }
      audioSession = session;
      return session;
    }).finally(() => {
      if (microphonePromise === opening) {
        microphonePromise = null;
        microphonePromiseGeneration = -1;
      }
    });
    microphonePromise = opening;
    microphonePromiseGeneration = generation;
  }
  return microphonePromise;
}

function setupMeasurement() {
  $("measureErr").textContent = "";
  $("levelValue").textContent = "--";
  $("levelFill").style.width = "0%";
  $("levelFill").parentElement.setAttribute("aria-valuenow", "-60");
  releaseMicrophone();
  const generation = microphoneGeneration;
  ensureMicrophone(generation).then(session => {
    if (!session || generation !== microphoneGeneration) return;
    $("measureErr").textContent = "";
  }).catch(error => {
    if (generation === microphoneGeneration && current === "measuring") {
      $("measureErr").textContent = microphoneError(error);
    }
  });
}

async function beginMeasurement() {
  if (job) return;
  $("measureErr").textContent = "";
  const c = job = { cancelled: false };
  const idx = state.activeIdx;

  try {
    const session = await ensureMicrophone();
    if (!session || c.cancelled || current !== "measuring") return;
    await session.resume();
    const res = await runMeasurement(session, c, MEASUREMENT_SETTINGS);
    if (c.cancelled || current !== "measuring") return;
    const measured = { ...res, measuredAt: new Date(), uploaded: false };
    if (state.roomShape === "concave") {
      state.results[idx] = measured;
      delete state.trials[idx];
      if (redoMode) {
        redoMode = false;
        redoRoomSelected = false;
        state.activeIdx = 0;
      } else {
        const nextRoom = state.points.findIndex((_, roomIndex) => !state.results[roomIndex]);
        if (nextRoom >= 0) {
          state.activeIdx = nextRoom;
          location.hash = "position";
          return;
        }
        state.activeIdx = 0;
      }
    } else {
      state.results[idx] = measured;
    }
    location.hash = "result";
  } catch (err) {
    if (!c.cancelled) {
      $("measureErr").textContent = `${microphoneError(err)} P5に戻り「測定開始」を押して再試行してください。`;
    }
  } finally {
    if (job === c) job = null;
  }
}

/* ---------- P7 結果 ---------- */
function renderResult() {
  const r = state.results[state.activeIdx];
  const isConcave = state.roomShape === "concave";
  $("resMeta").textContent =
    `${state.facility}(${state.pref}${state.city})/ ${state.use}${state.useNote ? "(" + state.useNote + ")" : ""} / ` +
    `${isConcave ? "部屋1・部屋2 各1回測定" : `測定点 ${state.activeIdx + 1}`} / ${r.measuredAt.toLocaleString("ja-JP")}`;
  $("singleResultSummary").hidden = isConcave;
  $("singleQualitySummary").hidden = isConcave;
  $("concaveResults").hidden = !isConcave;
  $("singleIrCard").hidden = isConcave;
  $("singleSaveCard").hidden = isConcave;
  $("redoBtn").textContent = isConcave ? "2部屋を同時に測定し直す" : "同じ場所で測定をやり直す";
  $("resRt").textContent = fmt(r.rt60) + " 秒";
  $("resEdt").textContent = fmt(r.edt) + " 秒";
  if (isConcave) {
    renderConcaveResults();
  }
  $("r2Value").textContent = r.r2 == null ? "--" : `${fmt(r.r2 * 100)}%`;
  $("validValue").textContent = r.r2 == null ? "未評価" : (r.r2 > 0.8 ? "有効" : "再測定推奨");
  $("demoNote").hidden = !DEMO;
  $("uploadErr").textContent = "";
  if (!isConcave) {
    updateUploadUI();
    drawImpulseResponse(r);
    if (lastSaveNameIndex !== state.activeIdx || !$("saveName").value) {
      $("saveName").value = `${state.use} 測定点${state.activeIdx + 1}`;
      lastSaveNameIndex = state.activeIdx;
    }
  }
}
function renderConcaveResults() {
  const root = $("concaveResults");
  root.replaceChildren();
  getConcaveReadings().forEach(({ label, result }, readingIndex) => {
    const card = el("article", null, "card");
    card.appendChild(el("h3", label));
    const summary = el("div", null, "summary two");
    summary.append(
      metric("RT60", result.rt60),
      metric("EDT", result.edt)
    );
    const quality = el("div", null, "summary two");
    const validity = el("div", "有効性");
    validity.appendChild(el("b", result.r2 > 0.8 ? "有効" : "再測定推奨"));
    quality.append(
      qualityMetric("適合度 R²", result.r2),
      validity
    );
    const canvas = document.createElement("canvas");
    canvas.className = "result-chart";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `${label}のインパルス応答`);
    canvas.dataset.resultIndex = String(readingIndex);
    card.append(summary, quality, canvas);
    if (readingIndex > 0) {
      const roomIndex = readingIndex - 1;
      const redoButton = el("button", "同じ場所で測定をやり直す", "btn secondary");
      redoButton.type = "button";
      redoButton.addEventListener("click", () => redoConcaveRoom(roomIndex));
      card.appendChild(redoButton);
    }
    root.appendChild(card);
    drawImpulseResponse(result, canvas);
  });
  root.appendChild(createConcaveSaveCard());
}
function getConcaveReadings() {
  const room1 = state.results[0], room2 = state.results[1];
  return [
    { label: "2部屋平均", result: averageMeasurements([room1, room2]) },
    { label: "部屋1", result: room1 },
    { label: "部屋2", result: room2 }
  ];
}
function metric(label, value) {
  const item = el("div", label);
  const number = el("b", `${fmt(value)} 秒`);
  item.appendChild(number);
  return item;
}
function qualityMetric(label, value) {
  const item = el("div", label);
  item.appendChild(el("b", value == null ? "--" : `${fmt(value * 100)}%`));
  return item;
}
function createConcaveSaveCard() {
  const card = el("div", null, "card");
  card.appendChild(el("div", "3つの結果をまとめて保存", "card-title"));
  const form = el("div", null, "save-form");
  const label = el("label", null, "field");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "save-input";
  input.maxLength = 50;
  input.value = `${state.use} 部屋1・部屋2`;
  const id = "concaveSaveName";
  input.id = id;
  const caption = el("span", "測定名");
  label.htmlFor = id;
  label.append(caption, input);
  const button = el("button", "保存", "btn primary");
  button.type = "button";
  button.addEventListener("click", () => saveConcaveBundle(input, button, status, error));
  form.append(label, button);
  const status = el("div", null, "ok");
  const error = el("div", null, "error");
  card.append(form, status, error);
  button.disabled = state.results[0].uploaded && state.results[1].uploaded;
  if (button.disabled) {
    button.textContent = "保存済み";
    status.textContent = "✓ 3つの測定結果をまとめて保存しました。";
  }
  return card;
}
async function saveConcaveBundle(nameInput, button, status, error) {
  const name = nameInput.value.trim();
  if (!name) {
    error.textContent = "測定名を入力してください。";
    nameInput.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "保存中…";
  error.textContent = "";
  try {
    await uploadConcaveMeasurements(state, name);
    state.results[0].uploaded = true;
    state.results[1].uploaded = true;
    button.textContent = "保存済み";
    status.textContent = "✓ 3つの測定結果をまとめて保存しました。";
  } catch (err) {
    console.error("測定結果の保存に失敗しました。", err);
    error.textContent = saveErrorMessage(err);
    button.disabled = false;
    button.textContent = "保存";
  }
}
function redoConcaveRoom(roomIndex) {
  state.activeIdx = roomIndex;
  redoMode = true;
  redoRoomSelected = true;
  location.hash = "position";
}
function updateUploadUI() {
  const r = state.results[state.activeIdx];
  $("saveBtn").disabled = r.uploaded;
  $("saveBtn").textContent = r.uploaded ? "保存済み" : "保存";
  $("uploadMsg").textContent = r.uploaded ? "✓ 測定結果を保存しました。" : "";
}
$("saveBtn").addEventListener("click", async () => {
  await saveMeasurement(state.activeIdx, $("saveName"), $("saveBtn"), $("uploadMsg"), $("uploadErr"));
});
async function saveMeasurement(idx, nameInput, button, status, error) {
  const name = nameInput.value.trim();
  if (!name) {
    error.textContent = "測定名を入力してください。";
    nameInput.focus();
    return;
  }
  button.disabled = true;
  button.textContent = "保存中…";
  error.textContent = "";
  try {
    await uploadMeasurement(state, idx, name);
    state.results[idx].uploaded = true;
    button.textContent = "保存済み";
    status.textContent = "✓ 測定結果を保存しました。";
  } catch (err) {
    console.error("測定結果の保存に失敗しました。", err);
    error.textContent = saveErrorMessage(err);
    button.disabled = false;
    button.textContent = "保存";
  }
}

function saveErrorMessage(error) {
  const code = error && error.code;
  if (code === "permission-denied") {
    return "Firebaseの保存権限がありません。Firestoreルールがデプロイ済みか、匿名ログインがFirebaseで有効か確認してください。";
  }
  if (code === "auth/admin-restricted-operation" || code === "auth/operation-not-allowed") {
    return "Firebaseで匿名ログインが無効です。Firebase Console > Authentication > Sign-in method > Anonymous を有効にしてから、もう一度保存してください。";
  }
  if (code === "unauthenticated") {
    return "ログインできないため保存できません。ページを再読み込みして、もう一度保存してください。";
  }
  if (code === "unavailable" || code === "deadline-exceeded" || code === "network-request-failed") {
    return "Firebaseに接続できません。ネットワークを確認して、もう一度お試しください。";
  }
  if (code === "invalid-argument" || code === "data-loss") {
    return `保存データをFirebaseが受け付けませんでした（${code}）。もう一度測定してください。`;
  }
  const detail = [code, error && error.message].filter(Boolean).join(": ");
  return detail
    ? `保存に失敗しました（${detail}）。この内容を確認してください。`
    : "保存に失敗しました。ブラウザーの開発者ツールでFirebaseのエラーを確認してください。";
}

function drawImpulseResponse(r, canvas = $("irChart")) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !r.ir || !r.ir.length) return;
  const ratio = window.devicePixelRatio || 1;
  const width = rect.width, height = 210;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const styles = getComputedStyle(document.documentElement);
  const muted = styles.getPropertyValue("--muted").trim();
  const line = styles.getPropertyValue("--line").trim();
  const left = 42, right = width - 12, top = 14, bottom = height - 32;
  ctx.font = "11px sans-serif";
  ctx.fillStyle = muted;
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = top + (bottom - top) * i / 4;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillText(String(1 - i / 2), 2, y + 4);
  }
  ctx.fillText("時間", right - 30, height - 5);
  ctx.save();
  ctx.translate(11, (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText("振幅", 0, 0);
  ctx.restore();
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const stride = Math.max(1, Math.ceil(r.ir.length / Math.max(1, right - left)));
  for (let i = 0; i < r.ir.length; i += stride) {
    const x = left + (right - left) * i / Math.max(1, r.ir.length - 1);
    const y = bottom - (r.ir[i] + 1) / 2 * (bottom - top);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
window.addEventListener("resize", () => {
  if (current === "history") {
    document.querySelectorAll("#historyList canvas[data-history-ir]").forEach(canvas => {
      drawImpulseResponse({ ir: JSON.parse(canvas.dataset.historyIr) }, canvas);
    });
    return;
  }
  if (current !== "result") return;
  if (state.roomShape === "concave") {
    document.querySelectorAll("#concaveResults canvas[data-result-index]").forEach(canvas => {
      const reading = getConcaveReadings()[Number(canvas.dataset.resultIndex)];
      drawImpulseResponse(reading.result, canvas);
    });
  } else if (state.results[state.activeIdx]) {
    drawImpulseResponse(state.results[state.activeIdx]);
  }
});

// 同じ場所でやり直す(同じ測定点)
$("redoBtn").addEventListener("click", () => {
  if (state.roomShape === "concave") {
    state.results = {};
    state.trials = {};
    state.activeIdx = 0;
    redoMode = false;
    redoRoomSelected = false;
  } else {
    delete state.results[state.activeIdx];
    delete state.trials[state.activeIdx];
  }
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
  lastSaveNameIndex = -1;
  ["use", "useNote", "depth", "width", "depth1", "width1", "depth2", "width2", "height"].forEach(id => { $(id).value = ""; });
  document.querySelector('input[name="roomShape"][value="rectangular"]').checked = true;
  updateRoomShape();
  $("useNoteWrap").hidden = true;
  $("planArea").hidden = true;
  $("err").textContent = "";
  $("nextInfo").disabled = true;
  resetChecklist();
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
    list.querySelectorAll("canvas[data-history-ir]").forEach(canvas => {
      drawImpulseResponse({ ir: JSON.parse(canvas.dataset.historyIr) }, canvas);
    });
  } catch (e) {
    console.error(e);
    st.textContent = "結果を読み込めませんでした。通信状況を確認して、再読み込みしてください。";
  }
}
function historyCard(f) {
  const c = el("article", null, "card");
  c.append(
    el("h3", f.name),
    el("p", `県: ${f.prefecture}`, "meta"),
    el("p", `市区町村: ${f.city}`, "meta")
  );
  f.measurements.forEach(m => {
    const result = el("section", null, "card");
    result.appendChild(el("h3", `測定名: ${m.name || "未設定"}`));
    const average = m.resultSets && m.resultSets.find(set => set.key === "average");
    result.append(
      el("p", `RT60: ${fmt(average ? average.rt60 : m.rt60)} 秒`, "meta"),
      el("p", `EDT: ${fmt(average ? average.edt : m.edt)} 秒`, "meta")
    );
    const ir = average ? average.ir : m.ir;
    if (Array.isArray(ir) && ir.length) {
      const title = el("div", average ? "インパルス応答 (2部屋平均)" : "インパルス応答 (IR)", "card-title");
      const canvas = document.createElement("canvas");
      canvas.className = "result-chart";
      canvas.dataset.historyIr = JSON.stringify(ir);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", average ? "2部屋平均のインパルス応答" : "測定結果のインパルス応答");
      result.append(title, canvas);
    } else {
      result.appendChild(el("p", "この測定にはグラフデータが保存されていません。", "meta"));
    }
    c.appendChild(result);
  });
  return c;
}
$("historyReload").addEventListener("click", renderHistory);

/* ---------- 起動 ---------- */
show(location.hash.slice(1));