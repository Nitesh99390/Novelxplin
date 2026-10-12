/* =========================================================
   Novelxplin skeleton loader.
   Runs synchronously as soon as the <body> is parsed (before Firebase /
   catalog requests finish) and paints grey shimmer placeholders into the
   header and into every element carrying  data-sk="<type>".
   Page scripts simply overwrite innerHTML when real data arrives.
   Exposed as window.SK for async parts (chapter list, reader body, ...).
   ========================================================= */
(function () {
  const rep = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join("");
  const line = (cls) => `<span class="sk sk-line ${cls || ""}"></span>`;
  const W = ["w90", "w75", "w60", "", "w75", "w45", "w90", "w60"];
  const wrap = (cls, inner) => `<div class="sk-wrap ${cls || ""}" aria-busy="true" aria-live="polite">${inner}</div>`;

  const T = {
    header: () => `
      <div class="sk-header sk-dark"><div class="wrap">
        <span class="sk sk-logo"></span><span class="sk sk-navi"></span><span class="sk sk-navi" style="width:60px"></span>
        <span class="sk sk-search"></span><span class="sk sk-user"></span>
      </div><div class="sk-msearch"><span class="sk"></span></div></div>
      <div class="sk-notice"><div class="wrap"><span class="sk"></span></div></div>`,

    title: () => `<span class="sk sk-title"></span>`,
    crumb: () => wrap("sk-crumb", `<span class="sk" style="width:36px"></span><span class="sk" style="width:8px"></span><span class="sk" style="width:70px"></span><span class="sk" style="width:8px"></span><span class="sk" style="width:120px"></span>`),

    // index.html featured block: the container IS the grid, so we emit panels
    featured: () => `<div class="panel big sk-wrap" aria-busy="true"><span class="sk" style="flex:1;min-height:240px;height:100%"></span></div>` +
      rep(6, i => `<div class="panel f-card sk-wrap" aria-busy="true"><span class="sk sk-cover"></span><div>${line("lg " + W[i])}${line("w45 sm")}${line("w60")}${line("w75")}<span class="sk sk-chip"></span></div></div>`),

    release: (n) => rep(n || 12, i => `<li class="sk-wrap sk-release-row" aria-busy="true"><span class="sk" style="width:26px;height:26px"></span>${line(W[i % 8])}${line("w60")}${line("w75")}${line("w45")}</li>`),

    genres: () => wrap("genre-grid", rep(16, i => `<a>${line(["w60", "w45", "w75", "w30"][i % 4])}</a>`)),

    rank: (n) => `<ul class="rank-list sk-rank sk-wrap" aria-busy="true">${rep(n || 8, i => `<li><span class="sk sk-num"></span><span class="sk sk-cover"></span><div>${line("lg " + W[i % 8])}${line("w45 sm")}</div></li>`)}</ul>`,

    // novel cards – container is .novel-grid
    grid: (n) => rep(n || 6, i => `<div class="n-card sk-wrap" aria-busy="true"><span class="sk sk-cover"></span><div>${line("lg " + W[i % 8])}${line("w45 sm")}${line("w60")}${line("w75")}${line("w90")}${line("w60")}</div></div>`),

    lib: (n) => `<ul class="lib-list sk-wrap" aria-busy="true">${rep(n || 4, i => `<li><span class="sk sk-cover"></span><div>${line("lg " + W[i % 8])}${line("w45 sm")}</div><span class="sk" style="width:40px;height:12px"></span></li>`)}</ul>`,

    novelhead: () => wrap("novel-head sk-novel-head", `
      <span class="sk sk-cover"></span>
      <div>${line("xl w75")}${line("w30 sm")}
        ${rep(7, () => `<div class="info-row">${line("w60")}${line(["w45", "w75", "w90", "w30"][Math.floor(Math.random() * 4)])}</div>`)}
        <div class="sk-btns"><span class="sk sk-btn"></span><span class="sk sk-btn"></span><span class="sk sk-btn" style="width:140px"></span></div>
      </div>`),

    summary: () => wrap("summary", `${line()}${line("w90")}${line()}${line("w75")}${line("w90")}${line("w45")}`),

    chapters: (n) => rep(n || 20, i => `<a class="sk-chapters" tabindex="-1"><span class="sk" style="width:10px;height:10px;flex-shrink:0"></span>${line(W[i % 8])}<span class="sk" style="width:64px;height:10px;flex-shrink:0"></span></a>`),

    nav: () => wrap("sk-nav", `<span class="sk" style="width:84px"></span><span class="sk" style="width:84px"></span><span class="sk sel" style="width:260px"></span><span class="sk" style="width:84px"></span>`),

    reader: (n) => wrap("sk-reader", `${line("xl w60")}${line("sm w30")}<div style="height:16px"></div>` +
      rep(n || 4, p => rep(5, i => line(i === 4 ? "w45" : W[(p + i) % 8])) + `<div style="height:12px"></div>`)),

    tabs: () => wrap("sk-tabs", `<span class="sk"></span><span class="sk"></span><span class="sk"></span>`),

    filter: () => wrap("sk-filter", rep(5, r => `<div class="row">${line("w60")}<div class="opts">${rep([12, 4, 3, 5, 1][r], () => `<span class="sk"></span>`)}</div></div>`)),

    "filter-opts": (n) => rep(n || 14, () => `<span class="sk" style="height:24px;width:${56 + Math.floor(Math.random() * 40)}px"></span>`),

    text: (n) => wrap("", `<div style="padding:12px">${rep(n || 3, i => line(W[i % 8]))}</div>`),

    empty: () => ""
  };

  function html(type, n) { const f = T[type]; return f ? f(n) : T.text(n); }

  function paint(root) {
    (root || document).querySelectorAll("[data-sk]").forEach(el => {
      if (el.dataset.skDone) return;
      const [type, n] = el.dataset.sk.split(":");
      el.innerHTML = html(type, n ? +n : undefined);
      el.dataset.skDone = "1";
    });
  }

  // remove any skeleton that is still on screen (used by "not found" branches and the failsafe)
  function clear(root) {
    (root || document).querySelectorAll("[data-sk]").forEach(el => {
      el.querySelectorAll(":scope > .sk, .sk-wrap, .sk-chapters").forEach(x => x.remove());
    });
  }

  window.SK = { html, paint, clear };

  // Header first: it is a plain placeholder div present on every page.
  const h = document.getElementById("siteHeader");
  if (h && !h.innerHTML.trim()) h.innerHTML = T.header();
  paint(document);
})();
