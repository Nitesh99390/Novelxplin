/* Page entry: library.html (generated from inline script) */
import "../skeleton.js";
import "../config.js";
import "../data.js";
import "../app.js";

document.addEventListener("app:ready", () => {
  const { $, esc, U, cover, rankList, breadcrumb, I } = UI;
  $("#crumb").innerHTML = breadcrumb([{ label: "Home", href: U.home }, { label: "Your Library" }]);
  $("#lTitle").innerHTML = `${I.shelf} Your Library`;
  $("#hTitle").innerHTML = `${I.clock} Reading History`;
  $("#rTitle").innerHTML = `${I.star} Top Rated`;
  $("#ranking").innerHTML = rankList(DB.rankByRating(10));

  const u = Auth.user();
  $("#acct").innerHTML = u ? `${esc(u.name)} &middot; <a href="#" id="logout" style="color:var(--link)">Logout</a>` : `<a href="#" id="loginLink" style="color:var(--link)">Login to sync</a>`;
  $("#logout")?.addEventListener("click", async e => { e.preventDefault(); await Auth.logout(); location.reload(); });
  $("#loginLink")?.addEventListener("click", e => { e.preventDefault(); openLogin(); });

  function renderLib() {
    const ids = Lib.list();
    const hist = Lib.history();
    $("#lib").innerHTML = ids.length ? `<ul class="lib-list">${ids.map(id => { const n = DB.get(id); if (!n) return ""; const h = hist[id];
      return `<li>${cover(n)}<div><div class="t truncate"><a href="${U.novel(n.slug)}">${esc(n.title)}</a></div>
        <div class="s">${h ? `Read: <a href="${U.chapter(n.slug, h.chap)}">Chapter ${h.chap}</a> / ` : ""}Latest: <a href="${U.chapter(n.slug, DB.latestNum(n))}">Chapter ${DB.latestNum(n)}</a> &middot; ${DB.timeAgo(n.updatedMinutesAgo)}</div></div>
        <button class="rm" data-rm="${id}">Remove</button></li>`; }).join("")}</ul>`
      : `<div class="empty">${I.shelf}<div>Your library is empty.<br><a href="/most-popular" style="color:var(--link)">Browse popular novels</a> and add some.</div></div>`;
    $$("[data-rm]").forEach(b => b.addEventListener("click", () => { Lib.toggle(b.dataset.rm); renderLib(); toast("Removed from library"); }));
  }
  const $$ = UI.$$;
  function renderHist() {
    const h = Object.entries(Lib.history()).sort((a, b) => b[1].at - a[1].at);
    $("#hist").innerHTML = h.length ? `<ul class="lib-list">${h.map(([id, v]) => { const n = DB.get(id); if (!n) return "";
      return `<li>${cover(n)}<div><div class="t truncate"><a href="${U.novel(n.slug)}">${esc(n.title)}</a></div><div class="s">Chapter ${v.chap} &middot; ${DB.timeAgo(Math.round((Date.now() - v.at) / 6e4))}</div></div><a class="rm" href="${U.chapter(n.slug, v.chap)}" style="color:var(--link)">Continue</a></li>`; }).join("")}</ul>`
      : `<div class="empty">${I.clock}<div>No reading history yet.</div></div>`;
  }
  $("#clearHist").addEventListener("click", e => { e.preventDefault(); Lib.clearHistory(); renderHist(); toast("History cleared"); });
  renderLib(); renderHist();
});
