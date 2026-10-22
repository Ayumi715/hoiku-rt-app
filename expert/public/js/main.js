import { PREFECTURES, USES } from "./config.js";
import { watchAuth, signIn, signOut } from "./auth.js";
import { loadGroups, sortGroups, filterGroups } from "./data.js";
import { renderList, selected, setSelectionHandler } from "./card.js";
import { downloadGroups } from "./download.js";

PREFECTURES.forEach(p => $("searchPref").add(new Option(p, p)));
USES.forEach(u => $("searchUse").add(new Option(u, u)));

import { PREFECTURES, USES } from "./config.js";
import { loadGroups, sortGroups, filterGroups } from "./data.js";
import { renderList, selected, setSelectionHandler } from "./card.js";
import { downloadGroups } from "./download.js";

const $ = id => document.getElementById(id);
let allGroups = [], disposeList = null, disposeResult = null, lastResults = [], page = "list";

PREFECTURES.forEach(p => $("searchPref").add(new Option(p, p)));
USES.forEach(u => $("searchUse").add(new Option(u, u)));

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
  const sorted = sortGroups(allGroups, $("sortSelect").value);
  $("listStatus").textContent = sorted.length ? `${sorted.length}件` : "表示できるデータがありません。";
  disposeList = renderList($("listContainer"), sorted);
}
$("sortSelect").addEventListener("change", renderListView);

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
let useOn = false;
$("useToggle").addEventListener("click", () => {
  useOn = !useOn;
  $("useToggle").setAttribute("aria-pressed", String(useOn));
  $("searchUse").disabled = !useOn;
  if (!useOn) { $("searchUse").value = ""; $("searchUseOther").hidden = true; }
});
$("searchUse").addEventListener("change", () => {
  $("searchUseOther").hidden = $("searchUse").value !== "その他";
});

$("searchBtn").addEventListener("click", () => {
  const q = {
    name: $("searchName").value.trim(),
    pref: $("searchPref").value,
    city: $("searchCity").value.trim(),
    use: useOn ? $("searchUse").value : "",
    useNote: $("searchUseOther").value.trim()
  };
  if (!q.name && !q.pref && !q.city && !q.use) {
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