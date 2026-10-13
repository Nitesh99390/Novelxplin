/* Page entry: finder.html (generated from inline script) */
import "../skeleton.js";
import "../config.js";
import "../data.js";
import "../app.js";

document.addEventListener("app:ready", () => {
  const { $, $$, esc, U, nCard, breadcrumb, I } = UI;
  $("#crumb").innerHTML = breadcrumb([{ label: "Home", href: U.home }, { label: "Novel Finder" }]);
  $("#fTitle").innerHTML = `${I.search} Novel Finder`;
  $("#rTitle").innerHTML = `${I.list} Results`;
  $("#gOpts").innerHTML = DB.GENRES.map(g => `<label><input type="checkbox" name="g" value="${esc(g)}"> ${esc(g)}</label>`).join("");
  $("#tOpts").innerHTML = DB.LANGS.map(l => `<label><input type="checkbox" name="t" value="${esc(l)}"> ${esc(l.replace(" Novel", ""))}</label>`).join("");

  function run() {
    const fd = new FormData($("#filters"));
    const gs = fd.getAll("g"), ts = fd.getAll("t"), st = fd.get("status"), ch = fd.get("chap"), sort = fd.get("sort");
    let list = DB.novels.filter(n =>
      (!gs.length || gs.every(g => n.genres.includes(g))) &&
      (!ts.length || ts.includes(n.lang)) &&
      (!st || n.status === st) &&
      (!ch || (n.chapters >= +ch.split("-")[0] && n.chapters < +ch.split("-")[1]))
    );
    const s = { popular: (a, b) => b.views - a.views, rating: (a, b) => b.rating - a.rating, updated: (a, b) => a.updatedMinutesAgo - b.updatedMinutesAgo, chapters: (a, b) => b.chapters - a.chapters, new: (a, b) => (b.createdAt || 0) - (a.createdAt || 0) }; // id is a slug string – never subtract it
    list.sort(s[sort] || s.popular);
    $("#count").textContent = `${list.length} novels`;
    $("#grid").innerHTML = list.length ? list.map(n => nCard(n, { showFull: true, fullRibbon: true })).join("") : `<div class="empty" style="grid-column:1/-1">${I.search}<div>No novels match these filters.</div></div>`;
  }
  $("#filters").addEventListener("change", run);
  run();
});
