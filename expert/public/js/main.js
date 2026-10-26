import { PREFECTURES, USES, ROOM_VOLUME_RANGES } from "./config.js";
import { loadGroups, sortGroups, filterGroups } from "./data.js";
import { renderList, selected, setSelectionHandler } from "./card.js";
import { downloadGroups } from "./download.js";

const $ = id => document.getElementById(id);
let allGroups = [], disposeList = null, disposeResult = null, lastResults = [], page = "list";
let sortField = "date", sortDirection = "desc";

PREFECTURES.forEach(p => $("searchPref").add(new Option(p, p)));
USES.forEach(u => $("searchUse").add(new Option(u, u)));
ROOM_VOLUME_RANGES.forEach(range => $("searchVolume").add(new Option(range.label, range.value)));

/* ---------- 起動時にデータを読み込む ---------- */
(async () => {
  $("listStatus").textContent = "読み込み中…";
  try { allGroups = await loadGroups(); }
  catch (e) { console.error(e); $("listStatus").textContent = "データを読み込めませんでした。"; return; }
  renderListView();
  route();
})();

/* ---------- ページ切り替え(#list / #search) ---------- */
function route() {
  page = location.hash === "#search" ? "search" : "list";
  $("listView").hidden = page !== "list";
  $("searchView").hidden = page !== "search";
  $("magBtn").hidden = page !== "list";
  $("header").classList.remove("hide");
  updateSelBar();
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
$("magBtn").addEventListener("click", () => { location.hash = "search"; });
$("closeBtn").addEventListener("click", () => { location.hash = "list"; });

// 下にスクロールするとヘッダーが隠れ、上にスクロールすると出てくる
let lastY = 0;
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  if (y > lastY && y > 80) $("header").classList.add("hide");
  else if (y < lastY) $("header").classList.remove("hide");
  lastY = y;
}, { passive: true });

/* ---------- P1 一覧 ---------- */
function renderListView() {
  if (disposeList) disposeList();
  const order = sortField === "date" ? sortDirection : `${sortField}-${sortDirection}`;
  const sorted = sortGroups(allGroups, order);
  $("listStatus").textContent = sorted.length ? `${sorted.length}件` : "表示できるデータがありません。";
  disposeList = renderList($("listContainer"), sorted);
}
$("sortField").addEventListener("change", () => {
  sortField = $("sortField").value;
  renderListView();
});
document.querySelectorAll(".sort-direction").forEach(button => {
  button.addEventListener("click", () => {
    sortDirection = button.dataset.sortDirection;
    document.querySelectorAll(".sort-direction").forEach(direction => {
      direction.setAttribute("aria-pressed", String(direction === button));
    });
    renderListView();
  });
});

/* ---------- チェック選択 → まとめてダウンロード ---------- */
function updateSelBar() {
  $("selBar").hidden = selected.size === 0 || page !== "list";
  $("selCount").textContent = `${selected.size}件選択中`;
}
setSelectionHandler(updateSelBar);
$("selDownload").addEventListener("click", () => downloadGroups([...selected.values()]));
$("selCancel").addEventListener("click", () => {
  selected.clear();
  document.querySelectorAll("#listContainer .sel").forEach(c => { c.checked = false; });
  updateSelBar();
});

/* ---------- P2 検索 ---------- */
$("searchUse").addEventListener("change", () => {
  $("searchUseOther").hidden = $("searchUse").value !== "その他";
});

document.querySelectorAll(".shape-filter-button").forEach(button => {
  button.addEventListener("click", () => {
    const selected = button.getAttribute("aria-pressed") === "true";
    document.querySelectorAll(".shape-filter-button").forEach(option => {
      option.setAttribute("aria-pressed", String(option === button && !selected));
    });
  });
});

$("resetVolumeRange").addEventListener("click", () => {
  $("searchVolumeMin").value = "";
  $("searchVolumeMax").value = "";
  $("searchErr").textContent = "";
});

$("searchBtn").addEventListener("click", () => {
  const volumeMinInput = $("searchVolumeMin").value;
  const volumeMaxInput = $("searchVolumeMax").value;
  const volumeMin = volumeMinInput === "" ? null : Number(volumeMinInput);
  const volumeMax = volumeMaxInput === "" ? null : Number(volumeMaxInput);
  if ((volumeMin !== null && (!Number.isFinite(volumeMin) || volumeMin < 0)) ||
      (volumeMax !== null && (!Number.isFinite(volumeMax) || volumeMax < 0)) ||
      (volumeMin !== null && volumeMax !== null && volumeMin > volumeMax)) {
    $("searchErr").textContent = "容積の下限・上限を0以上の数値で指定してください。下限は上限以下にしてください。";
    return;
  }
  const q = {
    name: $("searchName").value.trim(),
    pref: $("searchPref").value,
    city: $("searchCity").value.trim(),
    use: $("searchUse").value,
    useNote: $("searchUseOther").value.trim(),
    volume: $("searchVolume").value,
    shape: document.querySelector('.shape-filter-button[aria-pressed="true"]')?.dataset.shape || "",
    volumeMin,
    volumeMax
  };
  if (!q.name && !q.pref && !q.city && !q.use && !q.volume &&
      !q.shape && q.volumeMin === null && q.volumeMax === null) {
    $("searchErr").textContent = "検索条件を1つ以上指定してください。";
    return;
  }
  $("searchErr").textContent = "";
  lastResults = sortGroups(filterGroups(allGroups, q), "desc");

  if (disposeResult) disposeResult();
  $("resultArea").hidden = false;
  $("resultCount").textContent = lastResults.length ? `${lastResults.length}件が見つかりました` : "該当するデータはありません。";
  $("resultDownload").hidden = lastResults.length === 0;
  disposeResult = renderList($("resultList"), lastResults, { selectable: false });
  $("resultArea").scrollIntoView({ behavior: "smooth", block: "start" });
});
$("resultDownload").addEventListener("click", () => downloadGroups(lastResults));