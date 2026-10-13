/* =========================================================
   Shared UI: header, footer, modal, helpers, components
   ========================================================= */
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- Clean URL routing ----------
     server.js serves the same static HTML for pretty paths; here we parse the
     path back into the parameters pages expect (n, c, g, sort, q, status, page)
     and merge them into `q` so `q.get("n")` keeps working everywhere.
       /                              → index
       /novel/<slug>[/page/2]         → novel.html   (n, page)
       /novel/<slug>/chapter-<c>      → read.html    (n, c)
       /genre/<genre-slug>[/ongoing|/completed][/page/2]
       /latest-novels | /latest-release | /most-popular | /completed-novels [/status][/page/N]
       /search/<term>[/ongoing|/completed][/page/2]  → search.html  (q, status)
       /library · /finder · /admin[/<slug>]
     Legacy *.html?x= URLs are 301-redirected by the server, but we still parse
     their query string so nothing breaks if the page is opened directly. */
  const LIST_PATHS = { "latest-novel": "latest-novels", "latest-release": "latest-release", "most-popular": "most-popular", "completed": "completed-novels" };
  const PATH_SORTS = Object.fromEntries(Object.entries(LIST_PATHS).map(([k, v]) => [v, k]));
  const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
  function parseRoute(pathname) {
    const seg = pathname.split("/").filter(Boolean).map(dec);
    const r = { page: "index", params: {} };
    if (seg.length >= 2 && seg[seg.length - 2] === "page" && /^\d+$/.test(seg[seg.length - 1])) { r.params.page = seg.pop(); seg.pop(); }
    const [a, b, c] = seg;
    if (!a) return r;
    const status = s => s && /^(ongoing|completed)$/.test(s) ? (r.params.status = s) : null;
    if (a === "novel" && b) {
      r.params.n = b;
      const m = c && /^chapter-(\d+)$/.exec(c);
      if (m) { r.page = "read"; r.params.c = m[1]; } else r.page = "novel";
    } else if (a === "genre" && b) { r.page = "genre"; r.params.g = b; status(c); }
    else if (PATH_SORTS[a]) { r.page = "list"; r.params.sort = PATH_SORTS[a]; status(b); }
    else if (a === "search") { r.page = "search"; if (b) r.params.q = b; status(c); }
    else if (a === "library" || a === "finder") r.page = a;
    else if (a === "admin") { r.page = "admin"; if (b) r.params.n = b; }
    else if (/\.html$/i.test(a)) r.page = a.replace(/\.html$/i, "");
    else r.page = "404";
    return r;
  }
  const route = parseRoute(location.pathname);
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(route.params)) if (!q.has(k)) q.set(k, v);
  const pg = p => p && +p > 1 ? `/page/${+p}` : "";
  const st = s => s && s !== "all" ? `/${s}` : "";
  const U = {
    home: "/", library: "/library", finder: "/finder",
    admin: slug => slug ? `/admin/${encodeURIComponent(slug)}` : "/admin",
    novel: (slug, page) => `/novel/${encodeURIComponent(slug)}${pg(page)}`,
    chapter: (slug, c) => `/novel/${encodeURIComponent(slug)}/chapter-${+c || 1}`,
    genre: (g, status, page) => `/genre/${slugify(g)}${st(status)}${pg(page)}`,
    list: (sort, status, page) => `/${LIST_PATHS[sort] || "latest-novels"}${st(status)}${pg(page)}`,
    search: (term, status, page) => `/search${term ? "/" + encodeURIComponent(String(term).trim()) : ""}${st(status)}${pg(page)}`,
    slugify,
  };
  window.U = U; window.ROUTE = route;

  /* ---------- SVG icons ---------- */
  const I = {
    search: '<svg class="icon" viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>',
    globe: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.6 15.6 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4a14 14 0 0 1 1.9 4h-3.8A14 14 0 0 1 12 4zM4.3 14a8 8 0 0 1 0-4h3.4a16 16 0 0 0 0 4H4.3zm.8 2h3a15.6 15.6 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.3-3.6A15.6 15.6 0 0 0 8.1 8zM12 20a14 14 0 0 1-1.9-4h3.8A14 14 0 0 1 12 20zm2.3-6H9.7a14.7 14.7 0 0 1 0-4h4.6a14.7 14.7 0 0 1 0 4zm.3 5.6a15.6 15.6 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.7-5.6a16 16 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z"/></svg>',
    list: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/></svg>',
    refresh: '<svg class="icon" viewBox="0 0 24 24"><path d="M17.65 6.35A8 8 0 1 0 19.7 14h-2.1a6 6 0 1 1-1.4-6.2L13 11h7V4l-2.35 2.35z"/></svg>',
    tag: '<svg class="icon" viewBox="0 0 24 24"><path d="M21.4 11.6l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .5.2 1 .6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8zM5.5 7A1.5 1.5 0 1 1 7 5.5 1.5 1.5 0 0 1 5.5 7z"/></svg>',
    dot: '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M10 16l6-4-6-4z" fill="#fff"/></svg>',
    rocket: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2.5s4.5 2 4.5 9.5c0 2.5-.6 4.4-1.3 5.8l1.8 3.7-3.2-1.6a4.6 4.6 0 0 1-3.6 0L7 21.5l1.8-3.7C8.1 16.4 7.5 14.5 7.5 12 7.5 5 12 2.5 12 2.5zm0 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg>',
    qr: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM3 21h8v-8H3v8zm2-6h4v4H5v-4zm8-12v8h8V3h-8zm6 6h-4V5h4v4zm-6 4h2v2h-2zm2 2h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm2-2h2v2h-2zm-2-4h2v2h-2zm2 2h2v2h-2zm-4 6h2v2h-2zm4 0h2v2h-2z"/></svg>',
    shelf: '<svg class="icon" viewBox="0 0 24 24"><path d="M4 3h4v18H4zm6 0h4v18h-4zm7.3.6l3.9 1-4.4 16.4-3.9-1z"/></svg>',
    user: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>',
    menu: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/></svg>',
    horn: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
    book: '<svg class="icon" viewBox="0 0 24 24"><path d="M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-1 16H7v-2h10v2zm0-4H7v-2h10v2zm0-4H7V8h10v2z"/></svg>',
    star: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 17.3l6.2 3.7-1.6-7 5.4-4.7-7.2-.6L12 2 9.2 8.7 2 9.3l5.4 4.7-1.6 7z"/></svg>',
    heart: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 21.4l-1.4-1.3C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1A6 6 0 0 1 16.5 3C19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.6 11.6L12 21.4z"/></svg>',
    chev: '<svg class="icon" viewBox="0 0 24 24"><path d="M10 6L8.6 7.4 13.2 12l-4.6 4.6L10 18l6-6z"/></svg>',
    left: '<svg class="icon" viewBox="0 0 24 24"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
    right: '<svg class="icon" viewBox="0 0 24 24"><path d="M10 6L8.6 7.4 13.2 12l-4.6 4.6L10 18l6-6z"/></svg>',
    home: '<svg class="icon" viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
    up: '<svg class="icon" viewBox="0 0 24 24"><path d="M7.4 15.4L12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>',
    eye: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>',
    pen: '<svg class="icon" viewBox="0 0 24 24"><path d="M3 17.3V21h3.8L17.8 9.9l-3.7-3.8L3 17.3zM20.7 7a1 1 0 0 0 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.7 3.8L20.7 7z"/></svg>',
    clock: '<svg class="icon" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm.5 5H11v6l5.2 3.1.8-1.2-4.5-2.7z"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
    gear: '<svg class="icon" viewBox="0 0 24 24"><path d="M19.4 13a7.6 7.6 0 0 0 .1-1 7.6 7.6 0 0 0-.1-1l2.1-1.7a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4L9 5a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.5 11a7.6 7.6 0 0 0 0 2l-2.1 1.7a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1a7.3 7.3 0 0 0 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.2 0 .4-.2.5-.4l.4-2.6a7.3 7.3 0 0 0 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/></svg>'
  };
  window.ICONS = I;

  /* ---------- Storage: localStorage cache + Firebase (Auth + Firestore) sync ---------- */
  const CFG = window.NX_CONFIG || {};
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  };
  const fbReady = !!(window.firebase && CFG.FIREBASE && CFG.FIREBASE.apiKey && !/^PASTE_/.test(CFG.FIREBASE.apiKey));
  let fbAuth = null, fbDb = null, curUser = null;
  if (fbReady) {
    try { firebase.initializeApp(CFG.FIREBASE); fbAuth = firebase.auth(); fbDb = firebase.firestore(); }
    catch (e) { console.warn("Firebase init failed", e); }
  }
  // Owner emails from config are always admins. Extra admins are managed by the owner
  // on the server (data/admins.json) – we ask /api/me after login so a newly-added
  // email becomes admin automatically on its next sign-in.
  const isOwnerEmail = em => !!em && (CFG.ADMIN_EMAILS || []).map(x => x.toLowerCase()).includes(String(em).toLowerCase());
  async function resolveRole(u) {
    const base = { admin: isOwnerEmail(u.email), owner: isOwnerEmail(u.email) };
    try {
      const tok = await u.getIdToken();
      const r = await fetch((CFG.API_BASE || "").replace(/\/$/, "") + "/api/me", { headers: { Authorization: "Bearer " + tok } });
      if (r.ok) { const j = await r.json(); return { admin: !!j.admin || base.admin, owner: !!j.owner || base.owner }; }
    } catch (e) { console.warn("role check", e.message); }
    return base;
  }
  const userDoc = () => (fbDb && curUser) ? fbDb.collection("users").doc(curUser.uid) : null;
  // write-through: update localStorage immediately, push to Firestore in background
  function pushCloud(patch) { const d = userDoc(); if (d) d.set(patch, { merge: true }).catch(e => console.warn("sync", e.message)); }

  const Lib = {
    list() { return store.get("nx_library", []); },
    has(id) { return this.list().includes(id); },
    toggle(id) { const l = this.list(); const i = l.indexOf(id); i >= 0 ? l.splice(i, 1) : l.unshift(id); store.set("nx_library", l); pushCloud({ library: l }); return i < 0; },
    history() { return store.get("nx_history", {}); },
    mark(id, chap) { const h = this.history(); h[id] = { chap, at: Date.now() }; store.set("nx_history", h); pushCloud({ history: h }); },
    clearHistory() { store.set("nx_history", {}); pushCloud({ history: {} }); },
    async pull() { // merge cloud → local on login
      const d = userDoc(); if (!d) return;
      try {
        const snap = await d.get(); const c = snap.exists ? snap.data() : {};
        const lib = [...new Set([...(c.library || []), ...this.list()])];
        const hist = Object.assign({}, c.history || {}, this.history());
        for (const k in (c.history || {})) if (hist[k] && c.history[k].at > hist[k].at) hist[k] = c.history[k];
        store.set("nx_library", lib); store.set("nx_history", hist);
        d.set({ library: lib, history: hist, email: curUser.email, name: curUser.displayName || "", photo: curUser.photoURL || "", admin: Auth.isAdmin(), lastSeen: Date.now() }, { merge: true });
      } catch (e) { console.warn("pull", e.message); }
    }
  };
  const TOK_KEY = "nx_idtok", TOK_TTL = 50 * 60 * 1000;
  const tokCache = {
    get() { try { const j = JSON.parse(sessionStorage.getItem(TOK_KEY) || "null"); if (j && j.t && j.exp > Date.now()) return j.t; } catch { } return null; },
    set(t, uid) { try { sessionStorage.setItem(TOK_KEY, JSON.stringify({ t, uid, exp: Date.now() + TOK_TTL })); } catch { } },
    clear() { try { sessionStorage.removeItem(TOK_KEY); } catch { } }
  };
  const Auth = {
    enabled: !!fbAuth,
    user() { return store.get("nx_user", null); },
    isAdmin() { const u = this.user(); return !!u && (u.admin === true || isOwnerEmail(u.email)); },
    isOwner() { const u = this.user(); return !!u && (u.owner === true || isOwnerEmail(u.email)); },
    // Firebase ID token, cached in sessionStorage for ~50 min (tokens are valid 60 min). On a cold
    // page load Firebase needs 1–3 s to restore the session before getIdToken() resolves – with the
    // cache the first chapter request fires instantly; the SDK refreshes the token in the background.
    async token() {
      const cached = tokCache.get(); if (cached) return cached;
      if (!fbAuth) return null;
      if (!fbAuth.currentUser) { try { await Promise.race([Auth.ready, new Promise(r => setTimeout(r, 4000))]); } catch { } }
      if (!fbAuth.currentUser) return null;
      const t = await fbAuth.currentUser.getIdToken(); tokCache.set(t, fbAuth.currentUser.uid); return t;
    },
    async login() {
      if (!fbAuth) { toast("Firebase config missing – set js/config.js"); return null; }
      const prov = new firebase.auth.GoogleAuthProvider();
      try { await fbAuth.signInWithPopup(prov); } catch (e) { if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") await fbAuth.signInWithRedirect(prov); else { toast(e.message); throw e; } }
    },
    async refreshToken() { tokCache.clear(); if (!fbAuth || !fbAuth.currentUser) return null; try { const t = await fbAuth.currentUser.getIdToken(true); tokCache.set(t, fbAuth.currentUser.uid); return t; } catch { return null; } },
    async logout() { localStorage.removeItem("nx_user"); tokCache.clear(); if (fbAuth) await fbAuth.signOut(); },
    // resolves once initial auth state is known
    ready: new Promise(res => {
      if (!fbAuth) return res(null);
      const off = fbAuth.onAuthStateChanged(async u => {
        curUser = u;
        if (!u) tokCache.clear(); else u.getIdToken().then(t => tokCache.set(t, u.uid)).catch(() => { }); // warm / refresh the cache
        if (u) { const role = await resolveRole(u); store.set("nx_user", { uid: u.uid, name: u.displayName || u.email.split("@")[0], email: u.email, photo: u.photoURL || "", admin: role.admin, owner: role.owner }); await Lib.pull(); }
        else localStorage.removeItem("nx_user");
        res(u); off && typeof off === "function" && 0; // keep listening for later changes
        document.dispatchEvent(new CustomEvent("auth:change", { detail: u }));
      });
    })
  };
  window.Lib = Lib; window.Auth = Auth;

  /* ---------- Toast ---------- */
  function toast(msg) {
    let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 2200);
  }
  window.toast = toast;

  /* ---------- Header ---------- */
  function genreLinks(cls) {
    return DB.GENRES.map(g => `<a href="${U.genre(g)}" class="${cls || ""}">${esc(g)}</a>`).join("");
  }
  function header() {
    const user = Auth.user();
    const userHtml = user
      ? `<a class="login-btn user-pill" href="${U.library}" title="${esc(user.email)}">${user.photo ? `<img class="avatar" src="${esc(user.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc(user.name[0])}</span>`}<span class="name">${esc(user.name)}</span></a>${user.admin ? `<a class="login-btn admin-btn" href="${U.admin()}" title="Admin panel">${I.pen} Admin</a>` : ""}`
      : `<button class="login-btn" id="loginBtn">${I.user} Login/Signup</button>`;
    return `
    <header class="header">
      <div class="wrap">
        <a class="logo" href="${U.home}"><span class="logo-badge">N</span><span class="logo-text"><span><span class="n">Novel</span>xplin</span></span></a>
        <ul class="main-nav">
          <li><a href="#" data-dd>Novel list <span class="caret"></span></a>
            <div class="dropdown">
              <a href="${U.library}">Your Library</a>
              <a href="${U.list("latest-novel")}">Latest Novels</a>
              <a href="${U.list("latest-release")}">Latest Release</a>
              <a href="${U.list("most-popular")}">Most Popular</a>
              <a href="${U.list("completed")}">Completed Novels</a>
              <a href="${U.finder}">Novel Finder<span class="new">New</span></a>
            </div>
          </li>
          <li><a href="#" data-dd>Genres <span class="caret"></span></a>
            <div class="dropdown genres">${genreLinks()}</div>
          </li>
          <li><a class="nav-rocket" href="${U.list("most-popular")}" title="Hot novels">${I.rocket}</a></li>
        </ul>
        <div class="header-right">
          <a class="icon-btn" href="#" title="Mobile app" id="qrBtn">${I.qr}</a>
          <a class="icon-btn" href="${U.library}" title="Your Library">${I.shelf}</a>
          <form class="search-form" action="/search" method="get" role="search">
            <input type="text" name="q" placeholder="Search novels" autocomplete="off" value="${esc(q.get("q") || "")}">
            <button type="submit" aria-label="Search">${I.search}</button>
          </form>
          ${userHtml}
          <button class="hamburger" id="hamburger" aria-label="Menu">${I.menu}</button>
        </div>
      </div>
      <nav class="mobile-nav" id="mobileNav">
        <div class="m-title">Novel list</div>
        <a href="${U.library}">Your Library</a>
        <a href="${U.list("latest-novel")}">Latest Novels</a>
        <a href="${U.list("latest-release")}">Latest Release</a>
        <a href="${U.list("most-popular")}">Most Popular</a>
        <a href="${U.list("completed")}">Completed Novels</a>
        <a href="${U.finder}">Novel Finder</a>
        <div class="m-title">Genres</div>
        <div class="m-genres">${genreLinks()}</div>
      </nav>
      <div class="mobile-search">
        <form class="search-form" action="/search" method="get" role="search">
          <input type="text" name="q" placeholder="Search novels" value="${esc(q.get("q") || "")}">
          <button type="submit" aria-label="Search">${I.search}</button>
        </form>
      </div>
    </header>
    <div class="notice"><div class="wrap">${I.horn} <span>Novelxplin &mdash; Read Web Novels Online, Free &amp; Fast</span></div></div>`;
  }

  function footer() {
    return `
    <footer class="footer">
      <div class="wrap">
        <div class="brand">Novelxplin</div>
        <div>Read Web Novels Online &mdash; your library &amp; history sync across devices.</div>
        <div class="links"><a href="#">Contact</a><a href="/sitemap.xml">Sitemap</a></div>
        <div class="links"><a href="#">Privacy Policy &amp; Terms of use</a></div>
        <div class="copy">&copy; ${new Date().getFullYear()} Novelxplin. All rights reserved.</div>
      </div>
    </footer>
    <div class="modal-bg" id="loginModal">
      <div class="modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Welcome to Novelxplin</h3><button id="closeModal" aria-label="Close">&times;</button></div>
        <div class="modal-body">
          <p>Sign in to sync your library, reading history and comments across all your devices.</p>
          <button class="g-btn" id="googleLogin">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l8 6.2C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.7 6c4.5-4.2 6.9-10.3 6.9-17.7z"/><path fill="#FBBC05" d="M10.6 28.5A14.5 14.5 0 0 1 9.8 24c0-1.6.3-3.1.8-4.5l-8-6.2A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l8-6.2z"/><path fill="#34A853" d="M24 48c6.3 0 11.7-2.1 15.6-5.7l-7.7-6c-2.1 1.4-4.8 2.3-7.9 2.3-6.2 0-11.5-4.1-13.4-9.8l-8 6.2C6.5 42.6 14.6 48 24 48z"/></svg>
            Log in with Google
          </button>
          <p class="hint">Don't Have an account? Click above to create an account.</p>
          <p class="legal"><a href="#">Terms of Service</a> / <a href="#">Privacy Policy</a></p>
        </div>
      </div>
    </div>
    <button class="to-top" id="toTop" aria-label="Scroll to top">${I.up}</button>`;
  }

  /* ---------- Components ---------- */
  function cover(n, extra) {
    const full = n.status === "Completed" && extra && extra.fullRibbon ? " full-badge" : "";
    const img = n.cover ? `<img src="${esc(n.cover)}" alt="" loading="lazy">` : "";
    return `<a class="cover${full}${n.cover ? " has-img" : ""}" href="${U.novel(n.slug)}" style="background:${n.color}">${img}<span class="glyph">${n.glyph}</span><span class="cover-title">${esc(n.title)}</span></a>`;
  }
  function stars(r) {
    const pct = Math.max(0, Math.min(100, (r / 5) * 100));
    const s = I.star.repeat(5);
    return `<span class="stars"><b>${r.toFixed(1)}</b><span class="star-row">${s}<span class="fill" style="width:${pct}%">${s}</span></span></span>`;
  }
  function metaLines(n, opts) {
    const g = n.genres.slice(0, 2).map(x => `<a href="${U.genre(x)}">${esc(x)}</a>`).join(", ");
    const full = (opts && opts.showFull && n.status === "Completed") ? `<span class="chip full">Full</span>` : "";
    return `<div class="meta">${I.globe} <span>${esc(n.lang)}</span></div>
      <div class="meta">${I.list} <span>${g}</span></div>
      <div>${full}<span class="chip">${n.chapters} Chapters</span></div>`;
  }
  function nCard(n, opts) {
    return `<div class="n-card">${cover(n, opts)}<div><h3 class="truncate"><a href="${U.novel(n.slug)}">${esc(n.title)}</a>${n.hot ? '<span class="badge-hot">HOT</span>' : ""}</h3>${stars(n.rating)}${metaLines(n, opts)}</div></div>`;
  }
  function releaseRow(n) {
    const ch = DB.latestNum(n); // real latest chapter number, not the file count
    const ct = DB.chapterTitle(n, ch).replace(/^Chapter\s*\d+\s*[:\-]?\s*/i, "") || String(ch);
    return `<li>
      ${cover(n)}
      <div class="title truncate"><a href="${U.novel(n.slug)}">${esc(n.title)}</a>${n.hot ? '<span class="badge-hot">HOT</span>' : ""}${n.isNew ? '<span class="badge-new">NEW</span>' : ""}</div>
      <div class="genres truncate">${n.genres.slice(0, 2).map(esc).join(", ")}</div>
      <a class="chap truncate" href="${U.chapter(n.slug, ch)}" title="${esc(DB.chapterTitle(n, ch))}">Ch. ${ch}${ct !== String(ch) ? ": " + esc(ct) : ""}</a>
      <div class="time">${DB.timeAgo(n.updatedMinutesAgo)}</div>
    </li>`;
  }
  function rankList(list) {
    return `<ul class="rank-list">${list.map((n, i) => `<li><div class="num">${i + 1}</div>${cover(n)}<div><div class="t truncate"><a href="${U.novel(n.slug)}">${esc(n.title)}</a></div><div class="s">${stars(n.rating)}</div><div class="s truncate">${n.genres.slice(0, 2).map(esc).join(", ")} &middot; ${n.chapters} ch</div></div></li>`).join("")}</ul>`;
  }
  function genreGrid() {
    return `<div class="genre-grid">${DB.GENRES.map(g => `<a href="${U.genre(g)}" class="${DB.GENRE_COLORS[g] || ""}">${I.dot} ${esc(g)}</a>`).join("")}</div>`;
  }
  function pagination(page, pages, mk) {
    if (pages <= 1) return "";
    const out = [];
    const add = (p, label, cls) => out.push(p === page ? `<span class="active">${label}</span>` : `<a href="${mk(p)}" class="${cls || ""}">${label}</a>`);
    if (page > 1) add(page - 1, "&laquo;");
    const win = new Set([1, 2, pages - 1, pages, page - 1, page, page + 1].filter(p => p >= 1 && p <= pages));
    let last = 0;
    [...win].sort((a, b) => a - b).forEach(p => { if (p - last > 1) out.push(`<span class="dots">…</span>`); add(p, p); last = p; });
    if (page < pages) add(page + 1, "&raquo;");
    return `<div class="pagination">${out.join("")}</div>`;
  }
  function panel(title, icon, body, more) {
    return `<section class="panel"><div class="panel-head"><h2>${icon || ""} ${esc(title)}</h2>${more ? `<a class="more" href="${more}">See more</a>` : ""}</div>${body}</section>`;
  }
  function breadcrumb(items) {
    return `<nav class="breadcrumb">${items.map((it, i) => (i ? '<span class="sep">›</span>' : "") + (it.href ? `<a href="${it.href}">${esc(it.label)}</a>` : `<span>${esc(it.label)}</span>`)).join("")}</nav>`;
  }

  window.UI = { $, $$, esc, q, U, route, cover, stars, metaLines, nCard, releaseRow, rankList, genreGrid, pagination, panel, breadcrumb, header, footer, I };

  /* ---------- Boot ---------- */
  document.addEventListener("DOMContentLoaded", async () => {
    await Promise.all([DB.ready, Auth.ready]);
    const h = $("#siteHeader"); if (h) h.innerHTML = header();
    if (DB.error) toast("Could not reach novel server: " + DB.error.message);
    const f = $("#siteFooter"); if (f) f.innerHTML = footer();

    // dropdowns
    $$("[data-dd]").forEach(a => a.addEventListener("click", e => {
      e.preventDefault(); const li = a.parentElement; const open = li.classList.contains("open");
      $$(".main-nav > li.open").forEach(x => x.classList.remove("open")); if (!open) li.classList.add("open");
    }));
    $$(".main-nav > li").forEach(li => {
      li.addEventListener("mouseenter", () => { if (li.querySelector(".dropdown")) li.classList.add("open"); });
      li.addEventListener("mouseleave", () => li.classList.remove("open"));
    });
    document.addEventListener("click", e => { if (!e.target.closest(".main-nav")) $$(".main-nav > li.open").forEach(x => x.classList.remove("open")); });

    // search forms → clean /search/<term> URL (server also accepts /search?q=)
    $$("form.search-form").forEach(f => f.addEventListener("submit", e => {
      const term = (f.querySelector("input[name=q]") || {}).value || "";
      if (!term.trim()) return; e.preventDefault(); location.href = U.search(term);
    }));

    // mobile
    const hb = $("#hamburger"); if (hb) hb.addEventListener("click", () => $("#mobileNav").classList.toggle("show"));

    // login modal
    const modal = $("#loginModal");
    const openModal = () => modal && modal.classList.add("show");
    const closeModal = () => modal && modal.classList.remove("show");
    $("#loginBtn")?.addEventListener("click", openModal);
    $("#closeModal")?.addEventListener("click", closeModal);
    modal?.addEventListener("click", e => { if (e.target === modal) closeModal(); });
    $("#googleLogin")?.addEventListener("click", async () => { try { await Auth.login(); closeModal(); toast("Signed in"); setTimeout(() => location.reload(), 400); } catch { } });
    $("#qrBtn")?.addEventListener("click", e => { e.preventDefault(); toast("Mobile app coming soon"); });
    window.openLogin = openModal;

    // scroll top
    const tt = $("#toTop");
    window.addEventListener("scroll", () => tt && tt.classList.toggle("show", scrollY > 400), { passive: true });
    tt?.addEventListener("click", () => scrollTo({ top: 0, behavior: "smooth" }));

    document.dispatchEvent(new CustomEvent("app:ready"));

    // Skeleton failsafe: page scripts replace each data-sk container when their data
    // arrives. If something throws (or a container has no renderer) the shimmer must
    // not stay forever – freeze it shortly after ready and wipe it a bit later.
    if (window.SK) {
      setTimeout(() => $$("[data-sk]").forEach(el => el.querySelector(".sk") && el.classList.add("sk-stale")), 6000);
      setTimeout(() => SK.clear(), 12000);
    }
  });
})();
