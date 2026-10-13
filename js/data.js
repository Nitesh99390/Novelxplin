/* =========================================================
   Novelxplin data layer – talks to the Oracle backend (server.js).
   Catalog (all novel metadata) is loaded once; chapters are fetched
   on demand. Everything is exposed on window.DB.
   ========================================================= */
(function () {
  const CFG = window.NX_CONFIG || {};
  const API = (CFG.API_BASE || "").replace(/\/$/, "");

  const GENRES = [
    "Action", "Adult", "Adventure", "Comedy", "Drama", "Eastern", "Ecchi", "Fan-fic",
    "Fantasy", "Game", "Gender Bender", "Harem", "Historical", "Horror", "Josei",
    "Martial Arts", "Mature", "Mecha", "Mystery", "Psychological", "Reincarnation",
    "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo", "Shounen Ai", "Shounen",
    "Slice of Life", "Smut", "Sports", "Supernatural", "System", "Tragedy", "Wuxia",
    "Xianxia", "Xuanhuan", "Yaoi"
  ];
  const GENRE_COLORS = { Action: "c-green", Adventure: "c-orange", Fantasy: "c-purple", "Martial Arts": "c-red", Romance: "c-red", System: "c-blue" };
  const LANGS = ["English Novel", "Chinese Novel", "Korean Novel", "Japanese Novel"];
  const STATUS = ["Ongoing", "Completed"];
  const PALETTE = ["#1f3a5f", "#5a1f3a", "#1f5a3a", "#4a3a1f", "#2d1f5a", "#5a2d1f", "#1f4a5a", "#3a3a3a", "#6b2c2c", "#2c4a6b", "#4b2c6b", "#2c6b4b", "#7a4a12", "#12527a", "#7a1240", "#334155"];
  const GLYPHS = ["⚔", "🐉", "🌙", "✦", "🔥", "❄", "⚡", "🌸", "🗡", "🏯", "☯", "🌌", "👑", "🩸", "🦊", "📜"];

  let novels = [];
  let bySlug = {};
  let loadError = null;

  async function api(path, opts) {
    const r = await fetch(API + path, opts);
    if (!r.ok) { let m = r.statusText; try { m = (await r.json()).error || m; } catch { } throw new Error(m); }
    return r.json();
  }

  function normalize(n) {
    n.genres = Array.isArray(n.genres) && n.genres.length ? n.genres : ["Fantasy"];
    n.chapters = +n.chapters || 0;
    n.rating = +n.rating || 0;
    n.votes = +n.votes || 0;
    n.views = +n.views || 0;
    n.color = n.color || PALETTE[n.title.length % PALETTE.length];
    n.glyph = n.glyph || GLYPHS[n.title.length % GLYPHS.length];
    n.lang = n.lang || LANGS[0];
    n.status = n.status === "Completed" ? "Completed" : "Ongoing";
    n.summary = Array.isArray(n.summary) ? n.summary : String(n.summary || "").split(/\n{2,}|\n/).filter(Boolean);
    n.updatedMinutesAgo = Math.max(0, Math.round((Date.now() - (n.updatedAt || n.createdAt || Date.now())) / 6e4));
    n.isNew = Date.now() - (n.createdAt || 0) < 7 * 864e5;
    n.id = n.slug;
    return n;
  }

  const ready = (async () => {
    try {
      const list = await api("/api/novels");
      novels = list.map(normalize);
      bySlug = Object.fromEntries(novels.map(n => [n.slug, n]));
    } catch (e) { loadError = e; console.warn("Catalog load failed:", e.message); }
    return novels;
  })();

  function chapterTitle(novel, idx) {
    if (novel.latest && novel.latest.num === idx && novel.latest.title) return novel.latest.title;
    return `Chapter ${idx}`;
  }
  function timeAgo(mins) {
    if (mins < 1) return "just now";
    if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} mins ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
    const d = Math.floor(h / 24);
    if (d < 30) return d === 1 ? "a day ago" : `${d} days ago`;
    const mo = Math.floor(d / 30);
    return mo === 1 ? "a month ago" : `${mo} months ago`;
  }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

  window.DB = {
    GENRES, GENRE_COLORS, LANGS, STATUS, PALETTE, GLYPHS, ready, api, slugify, timeAgo, chapterTitle,
    get novels() { return novels; },
    get error() { return loadError; },
    get(slug) { return bySlug[slug] || null; },
    // async: full chapter index [{num,title,date}]
    chapters(slug) { return api(`/api/novels/${encodeURIComponent(slug)}/chapters`); },
    // async: {num,title,date,body:[...]}
    chapter(slug, num) { return api(`/api/novels/${encodeURIComponent(slug)}/chapters/${num}`); },
    featured() { return [...novels].sort((a, b) => b.views - a.views).slice(0, 7); },
    latestRelease(limit) { return [...novels].filter(n => n.chapters > 0).sort((a, b) => a.updatedMinutesAgo - b.updatedMinutesAgo).slice(0, limit || novels.length); },
    latestNovels(limit) { return [...novels].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, limit || novels.length); },
    mostPopular(limit) { return [...novels].sort((a, b) => b.views - a.views).slice(0, limit || novels.length); },
    completed(limit) { return novels.filter(n => n.status === "Completed").sort((a, b) => b.rating - a.rating).slice(0, limit || novels.length); },
    byGenre(g) { return novels.filter(n => n.genres.map(x => x.toLowerCase()).includes(String(g).toLowerCase())); },
    search(q) { q = String(q || "").trim().toLowerCase(); if (!q) return []; return novels.filter(n => n.title.toLowerCase().includes(q) || (n.author || "").toLowerCase().includes(q) || n.genres.join(" ").toLowerCase().includes(q)); },
    rankByRating(limit) { return [...novels].filter(n => n.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, limit || 10); },

    /* ---- user ratings (signed-in users, one vote per novel) ---- */
    async ratingHeaders() {
      const h = { "Content-Type": "application/json" };
      const tok = window.Auth && Auth.token ? await Auth.token().catch(() => null) : null;
      if (tok) h.Authorization = "Bearer " + tok;
      return h;
    },
    // {votes, rating, dist:[n1..n5], baseRating, shown, mine}
    async rating(slug) { return api(`/api/novels/${encodeURIComponent(slug)}/rating`, { headers: await this.ratingHeaders(), cache: "no-store" }); },
    async rate(slug, r) {
      const s = await api(`/api/novels/${encodeURIComponent(slug)}/rating`, { method: "POST", headers: await this.ratingHeaders(), body: JSON.stringify({ rating: r }) });
      const n = bySlug[slug]; if (n) { n.rating = s.shown; n.votes = s.votes; }
      return s;
    },
    async unrate(slug) {
      const s = await api(`/api/novels/${encodeURIComponent(slug)}/rating`, { method: "DELETE", headers: await this.ratingHeaders() });
      const n = bySlug[slug]; if (n) { n.rating = s.shown; n.votes = s.votes; }
      return s;
    }
  };
})();
