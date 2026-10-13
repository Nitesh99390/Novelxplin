/* Page entry: list.html (generated from inline script) */
import "../skeleton.js";
import "../config.js";
import "../data.js";
import "../app.js";

document.addEventListener("app:ready", () => {
  const { $, esc, q, U, nCard, genreGrid, rankList, pagination, breadcrumb, I } = UI;
  const PER = 18;
  const page = Math.max(1, parseInt(q.get("page") || "1", 10));
  const sort = q.get("sort") || "latest-novel";
  const genre = q.get("g") ? DB.genreName(q.get("g")) : null;
  const query = q.get("q");
  const status = q.get("status") || "all";

  let list, title, crumbLabel, mk, tabUrl;
  if (query !== null) {
    list = DB.search(query);
    title = `Search results for "${query}"`; crumbLabel = "Search"; mk = p => U.search(query, status, p); tabUrl = s => U.search(query, s);
    document.title = `Search: ${query} - Novelxplin`;
  } else if (genre) {
    list = DB.byGenre(genre);
    title = `${genre} Novels`; crumbLabel = genre; mk = p => U.genre(genre, status, p); tabUrl = s => U.genre(genre, s);
    document.title = `${genre} Novels - Novelxplin`;
  } else {
    const map = {
      "latest-novel": ["Latest Novels", DB.latestNovels()],
      "latest-release": ["Latest Release Novels", DB.latestRelease()],
      "most-popular": ["Most Popular Novels", DB.mostPopular()],
      "completed": ["Completed Novels", DB.completed()]
    };
    const m = map[sort] || map["latest-novel"];
    title = m[0]; list = m[1]; crumbLabel = m[0]; mk = p => U.list(sort, status, p); tabUrl = s => U.list(sort, s);
    document.title = `${m[0]} - Novelxplin`;
  }
  if (status !== "all") list = list.filter(n => n.status.toLowerCase() === status);

  const pages = Math.max(1, Math.ceil(list.length / PER));
  const cur = Math.min(page, pages);
  const slice = list.slice((cur - 1) * PER, cur * PER);
  const tab = (s, label) => `<a href="${tabUrl(s)}" class="${status === s ? "active" : ""}">${label}</a>`;

  $("#crumb").innerHTML = breadcrumb([{ label: "Home", href: U.home }, { label: crumbLabel }]);
  $("#title").innerHTML = `${I.list} ${esc(title)}`;
  $("#count").textContent = `${list.length} novels`;
  $("#tabs").innerHTML = tab("all", "All") + tab("ongoing", "Ongoing") + tab("completed", "Completed");
  $("#grid").innerHTML = slice.length
    ? slice.map(n => nCard(n, { showFull: true, fullRibbon: true })).join("")
    : `<div class="empty" style="grid-column:1/-1">${I.search}<div>No novels found.</div></div>`;
  $("#pager").innerHTML = pagination(cur, pages, mk);
  $("#gTitle").innerHTML = `${I.list} Genres`;
  $("#genres").innerHTML = genreGrid();
  $("#rTitle").innerHTML = `${I.star} Top Rated`;
  $("#ranking").innerHTML = rankList(DB.rankByRating(10));
});
