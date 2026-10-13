/* Page entry: 404.html (generated from inline script) */
import "../skeleton.js";
import "../config.js";
import "../data.js";
import "../app.js";

document.addEventListener("app:ready", () => {
  const { $, U, nCard, genreGrid, breadcrumb, I } = UI;
  $("#crumb").innerHTML = breadcrumb([{ label: "Home", href: U.home }, { label: "Page not found" }]);
  $("#title").innerHTML = `${I.search} Page not found`;
  $("#pTitle").innerHTML = `${I.rocket} Popular right now`;
  $("#gTitle").innerHTML = `${I.tag} Genres`;
  const pop = DB.mostPopular(6);
  $("#popular").innerHTML = pop.length ? pop.map(n => nCard(n)).join("") : `<div class="empty" style="grid-column:1/-1">No novels yet.</div>`;
  $("#genres").innerHTML = genreGrid();
});
