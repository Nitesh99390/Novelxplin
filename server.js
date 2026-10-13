/* =========================================================
   Novelxplin backend – zero-dependency Node.js server.
   Runs comfortably on a 1 GB RAM Oracle instance.

   • Serves the static frontend (this folder)
   • Stores novels as files under ./data  (metadata: catalog.json,
     chapters: data/chapters/<slug>/<num>.json)
   • Admin writes require a Firebase ID token whose email is in
     ADMIN_EMAILS (token is verified against Google's public certs –
     no firebase-admin package needed).

   Run:  node server.js            (PORT env, default 3000)
   ========================================================= */
const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const zlib = require("zlib");

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const CHAP = path.join(DATA, "chapters");
const UPLOADS = path.join(DATA, "uploads");
const CATALOG = path.join(DATA, "catalog.json");
const ADMINS_FILE = path.join(DATA, "admins.json");
const PORT = +process.env.PORT || 3000;

// Owner emails (super-admins): env override or js/config.js. Owners can add/remove
// extra admins from the admin panel; those are persisted in data/admins.json.
let ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
let FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || "";
try {
  const cfgSrc = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
  const m = cfgSrc.match(/ADMIN_EMAILS:\s*\[([^\]]*)\]/);
  if (m && !ADMIN_EMAILS.length) ADMIN_EMAILS = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1].toLowerCase());
  const p = cfgSrc.match(/projectId:\s*"([^"]+)"/);
  if (p && !FIREBASE_PROJECT) FIREBASE_PROJECT = p[1];
} catch { }
if (!ADMIN_EMAILS.length) ADMIN_EMAILS = ["bhuimharniteshbhuimhar@gmail.com"];

for (const d of [DATA, CHAP, UPLOADS]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(CATALOG)) fs.writeFileSync(CATALOG, "[]");
if (!fs.existsSync(ADMINS_FILE)) fs.writeFileSync(ADMINS_FILE, "[]");

/* ---------- admins (owner-managed, persisted in data/admins.json) ---------- */
const OWNERS = ADMIN_EMAILS.slice();
let extraAdmins = []; // [{ email, addedBy, addedAt }]
try { extraAdmins = JSON.parse(fs.readFileSync(ADMINS_FILE, "utf8")); if (!Array.isArray(extraAdmins)) extraAdmins = []; } catch { extraAdmins = []; }
async function saveAdmins() {
  const tmp = ADMINS_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(extraAdmins, null, 2));
  await fsp.rename(tmp, ADMINS_FILE);
}
const normEmail = e => String(e || "").trim().toLowerCase();
const isOwner = e => OWNERS.includes(normEmail(e));
const isAdmin = e => { e = normEmail(e); return !!e && (OWNERS.includes(e) || extraAdmins.some(a => a.email === e)); };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- catalog (kept in memory, persisted atomically) ---------- */
let catalog = [];
try { catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8")); } catch { catalog = []; }
let saveTimer = null;
function saveCatalog() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const tmp = CATALOG + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(catalog));
    await fsp.rename(tmp, CATALOG);
  }, 150);
}
const bySlug = s => catalog.find(n => n.slug === s);
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 120);
const safeNum = n => { n = parseInt(n, 10); return Number.isFinite(n) && n > 0 && n < 100000 ? n : null; };
const chapDir = slug => path.join(CHAP, slug);
const chapFile = (slug, num) => path.join(chapDir(slug), num + ".json");

async function chapterIndex(slug) {
  const dir = chapDir(slug);
  let files = []; try { files = await fsp.readdir(dir); } catch { return []; }
  const nums = files.filter(f => f.endsWith(".json") && !f.startsWith("_")).map(f => +f.slice(0, -5)).filter(Number.isFinite).sort((a, b) => a - b);
  // index file keeps titles without opening every chapter
  let idx = {}; try { idx = JSON.parse(await fsp.readFile(path.join(dir, "_index.json"), "utf8")); } catch { }
  return nums.map(num => ({ num, title: (idx[num] && idx[num].t) || `Chapter ${num}`, date: (idx[num] && idx[num].d) || "" }));
}
async function updateIndex(slug, num, title, date) {
  const f = path.join(chapDir(slug), "_index.json");
  let idx = {}; try { idx = JSON.parse(await fsp.readFile(f, "utf8")); } catch { }
  if (title === null) delete idx[num]; else idx[num] = { t: title, d: date };
  await fsp.writeFile(f, JSON.stringify(idx));
}
async function refreshNovelStats(n) {
  const list = await chapterIndex(n.slug);
  n.chapters = list.length;
  const last = list[list.length - 1];
  n.latest = last ? { num: last.num, title: last.title } : null;
  n.updatedAt = Date.now();
  saveCatalog(); smInvalidate();
}

/* ---------- Firebase ID-token verification (RS256 via Google certs) ---------- */
let certs = { exp: 0, keys: {} };
function fetchJSON(url) {
  return new Promise((res, rej) => https.get(url, r => {
    let b = ""; r.on("data", d => b += d); r.on("end", () => { try { res({ headers: r.headers, body: JSON.parse(b) }); } catch (e) { rej(e); } });
  }).on("error", rej));
}
async function googleCerts() {
  if (Date.now() < certs.exp) return certs.keys;
  const { headers, body } = await fetchJSON("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
  const m = /max-age=(\d+)/.exec(headers["cache-control"] || "");
  certs = { exp: Date.now() + (m ? +m[1] : 3600) * 1000, keys: body };
  return certs.keys;
}
const b64url = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
async function verifyIdToken(token) {
  const parts = String(token || "").split("."); if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(b64url(parts[0]).toString()); const payload = JSON.parse(b64url(parts[1]).toString());
  if (header.alg !== "RS256") throw new Error("bad alg");
  const keys = await googleCerts(); const cert = keys[header.kid]; if (!cert) throw new Error("unknown key");
  const ok = crypto.createVerify("RSA-SHA256").update(parts[0] + "." + parts[1]).verify(cert, b64url(parts[2]));
  if (!ok) throw new Error("bad signature");
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("expired");
  if (FIREBASE_PROJECT && payload.aud !== FIREBASE_PROJECT) throw new Error("bad audience");
  if (!payload.email) throw new Error("no email");
  return payload;
}
async function requireAdmin(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw Object.assign(new Error("Login required"), { status: 401 });
  // Dev bypass: ADMIN_DEV_TOKEN env lets you test without Firebase
  if (process.env.ADMIN_DEV_TOKEN && token === process.env.ADMIN_DEV_TOKEN) return { email: OWNERS[0], dev: true, owner: true };
  let p; try { p = await verifyIdToken(token); } catch (e) { throw Object.assign(new Error("Invalid token: " + e.message), { status: 401 }); }
  if (!isAdmin(p.email)) throw Object.assign(new Error("Not an admin"), { status: 403 });
  p.owner = isOwner(p.email);
  return p;
}
async function requireOwner(req) {
  const u = await requireAdmin(req);
  if (!u.owner) throw Object.assign(new Error("Only the site owner can manage admins"), { status: 403 });
  return u;
}

/* ---------- helpers ---------- */
function send(res, code, body, headers) {
  const isObj = typeof body !== "string" && !Buffer.isBuffer(body);
  const data = isObj ? JSON.stringify(body) : body;
  res.writeHead(code, Object.assign({ "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS" }, headers || {}));
  res.end(data);
}
function readBody(req, limit) {
  return new Promise((res, rej) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > (limit || 50 * 1024 * 1024)) { rej(Object.assign(new Error("Payload too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => res(Buffer.concat(chunks))); req.on("error", rej);
  });
}
async function readJSON(req, limit) { const b = await readBody(req, limit); try { return JSON.parse(b.toString("utf8") || "{}"); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); } }
const splitParas = t => String(t || "").replace(/\r/g, "").split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2" };

/* ---------- SEO: robots.txt + dynamic XML sitemaps ----------
   /sitemap.xml                     → sitemap index (lists everything below)
   /sitemap-pages.xml               → static pages + genre listing pages
   /sitemap-novels.xml              → one <url> per novel (+ cover image)
   /sitemap-chapters-<slug>.xml     → every chapter of one novel (read.html?n=&c=)
   All generated from the in-memory catalog, cached for 10 min, gzip on request.
   Canonical host comes from SITE_URL env (fallback: request Host header).   */
//   PUBLIC_URL=https://novelxplin.in  (preferred)  → else SITE_URL if it is a real
//   domain (a bare IP like http://144.24.x.x is ignored) → else request Host header.
const isIpUrl = u => /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d+)?\/?$/i.test(u) || /^https?:\/\/localhost/i.test(u);
const SITE_URL = ([process.env.PUBLIC_URL, process.env.SITE_URL].map(u => (u || "").trim().replace(/\/$/, "")).find(u => u && !isIpUrl(u))) || "";
const xmlEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const isoDate = ms => { const d = ms ? new Date(ms) : new Date(); return (isNaN(d) ? new Date() : d).toISOString().slice(0, 10); };
const smCache = new Map(); // key -> { exp, body }
const SM_TTL = 10 * 60 * 1000;
function smGet(key, build) {
  const hit = smCache.get(key); if (hit && hit.exp > Date.now()) return hit.body;
  const body = build(); smCache.set(key, { exp: Date.now() + SM_TTL, body }); return body;
}
function siteBase(req) {
  if (SITE_URL) return SITE_URL;
  const proto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim() || "https";
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "localhost").split(",")[0].trim();
  return `${proto}://${host}`;
}
function urlTag(loc, lastmod, changefreq, priority, extra) {
  return `  <url>\n    <loc>${xmlEsc(loc)}</loc>` +
    (lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "") +
    (changefreq ? `\n    <changefreq>${changefreq}</changefreq>` : "") +
    (priority != null ? `\n    <priority>${priority}</priority>` : "") +
    (extra ? `\n${extra}` : "") + `\n  </url>`;
}
const SM_HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n`;
const URLSET_OPEN = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n`;
function buildSitemapIndex(base) {
  const newest = catalog.reduce((m, n) => Math.max(m, n.updatedAt || 0), 0);
  const items = [
    { loc: `${base}/sitemap-pages.xml`, lastmod: isoDate(newest) },
    { loc: `${base}/sitemap-novels.xml`, lastmod: isoDate(newest) },
    ...catalog.filter(n => n.chapters > 0).map(n => ({ loc: `${base}/sitemap-chapters-${n.slug}.xml`, lastmod: isoDate(n.updatedAt) })),
  ];
  return SM_HEAD + `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    items.map(i => `  <sitemap>\n    <loc>${xmlEsc(i.loc)}</loc>\n    <lastmod>${i.lastmod}</lastmod>\n  </sitemap>`).join("\n") + `\n</sitemapindex>\n`;
}
function buildPagesSitemap(base) {
  const today = isoDate();
  const out = [
    urlTag(`${base}/`, today, "daily", "1.0"),
    urlTag(`${base}/list.html`, today, "daily", "0.8"),
    urlTag(`${base}/list.html?sort=latest-novel`, today, "daily", "0.7"),
    urlTag(`${base}/list.html?sort=top-rated`, today, "weekly", "0.6"),
    urlTag(`${base}/list.html?status=completed`, today, "weekly", "0.6"),
    urlTag(`${base}/finder.html`, today, "weekly", "0.5"),
    urlTag(`${base}/library.html`, today, "monthly", "0.3"),
  ];
  const genres = [...new Set(catalog.flatMap(n => n.genres || []))].sort();
  for (const g of genres) out.push(urlTag(`${base}/genre.html?g=${encodeURIComponent(g)}`, today, "weekly", "0.6"));
  return SM_HEAD + URLSET_OPEN + out.join("\n") + `\n</urlset>\n`;
}
function buildNovelsSitemap(base) {
  const out = catalog.map(n => {
    const img = n.cover ? `    <image:image>\n      <image:loc>${xmlEsc(/^https?:/i.test(n.cover) ? n.cover : base + n.cover)}</image:loc>\n      <image:title>${xmlEsc(n.title)}</image:title>\n    </image:image>` : "";
    const freq = n.status === "Completed" ? "monthly" : "daily";
    const pri = n.hot ? "0.9" : "0.8";
    return urlTag(`${base}/novel.html?n=${encodeURIComponent(n.slug)}`, isoDate(n.updatedAt), freq, pri, img);
  });
  return SM_HEAD + URLSET_OPEN + out.join("\n") + `\n</urlset>\n`;
}
async function buildChaptersSitemap(base, n) {
  const list = await chapterIndex(n.slug);
  const freq = n.status === "Completed" ? "yearly" : "monthly";
  const out = list.map((c, i) => {
    const isLatest = i >= list.length - 3;
    return urlTag(`${base}/read.html?n=${encodeURIComponent(n.slug)}&c=${c.num}`, isoDate(c.date ? Date.parse(c.date) : n.updatedAt), isLatest ? "weekly" : freq, isLatest ? "0.6" : "0.5");
  });
  return SM_HEAD + URLSET_OPEN + out.join("\n") + `\n</urlset>\n`;
}
function buildRobots(base) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin.html",
    "Disallow: /api/",
    "Disallow: /library.html",
    "Disallow: /search.html?",
    "Disallow: /*?*q=",
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}
function sendXML(req, res, xml, maxAge) {
  const headers = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": `public, max-age=${maxAge || 600}`, "X-Robots-Tag": "noindex" };
  if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) { headers["Content-Encoding"] = "gzip"; return send(res, 200, zlib.gzipSync(Buffer.from(xml)), headers); }
  return send(res, 200, xml, headers);
}
async function handleSEO(req, res, p) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const base = siteBase(req);
  if (p === "/robots.txt") { send(res, 200, buildRobots(base), { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" }); return true; }
  if (p === "/sitemap.xml" || p === "/sitemap_index.xml") { sendXML(req, res, smGet("index:" + base, () => buildSitemapIndex(base))); return true; }
  if (p === "/sitemap-pages.xml") { sendXML(req, res, smGet("pages:" + base, () => buildPagesSitemap(base))); return true; }
  if (p === "/sitemap-novels.xml") { sendXML(req, res, smGet("novels:" + base, () => buildNovelsSitemap(base))); return true; }
  const m = /^\/sitemap-chapters-([a-z0-9-]+)\.xml$/.exec(p);
  if (m) {
    const n = bySlug(m[1]); if (!n) { send(res, 404, "Not found"); return true; }
    const key = `chap:${base}:${n.slug}:${n.updatedAt}`;
    const hit = smCache.get(key);
    let xml;
    if (hit && hit.exp > Date.now()) xml = hit.body;
    else { xml = await buildChaptersSitemap(base, n); smCache.set(key, { exp: Date.now() + SM_TTL, body: xml }); }
    sendXML(req, res, xml, 1800); return true;
  }
  return false;
}
const smInvalidate = () => smCache.clear(); // call whenever novels/chapters change (not on view counts)

function publicNovel(n) { const { ...o } = n; return o; }
function sanitizeNovel(body, existing) {
  const n = existing || {};
  if (body.title !== undefined) n.title = String(body.title).trim().slice(0, 200);
  if (!n.title) throw Object.assign(new Error("Title required"), { status: 400 });
  if (body.author !== undefined) n.author = String(body.author || "").trim().slice(0, 120);
  if (body.lang !== undefined) n.lang = String(body.lang || "English Novel").slice(0, 40);
  if (body.status !== undefined) n.status = body.status === "Completed" ? "Completed" : "Ongoing";
  if (body.genres !== undefined) n.genres = (Array.isArray(body.genres) ? body.genres : String(body.genres).split(",")).map(g => String(g).trim()).filter(Boolean).slice(0, 8);
  if (body.summary !== undefined) n.summary = Array.isArray(body.summary) ? body.summary.map(String) : splitParas(body.summary);
  if (body.cover !== undefined) n.cover = String(body.cover || "").slice(0, 500);
  if (body.hot !== undefined) n.hot = !!body.hot;
  if (body.rating !== undefined) n.rating = Math.max(0, Math.min(5, +body.rating || 0));
  if (body.color !== undefined) n.color = String(body.color || "").slice(0, 20);
  if (body.glyph !== undefined) n.glyph = String(body.glyph || "").slice(0, 4);
  return n;
}

/* ---------- shared write operations (used by HTTP API + Telegram bot) ---------- */
function createNovel(body) {
  const n = sanitizeNovel(body);
  let s = slugify(body.slug || n.title) || "novel"; let base = s, i = 2; while (bySlug(s)) s = `${base}-${i++}`;
  Object.assign(n, { slug: s, chapters: 0, views: 0, votes: 0, latest: null, createdAt: Date.now(), updatedAt: Date.now() });
  n.rating = n.rating || 0; n.genres = n.genres && n.genres.length ? n.genres : ["Fantasy"]; n.lang = n.lang || "English Novel"; n.status = n.status || "Ongoing"; n.summary = n.summary || [];
  catalog.unshift(n); fs.mkdirSync(chapDir(s), { recursive: true }); saveCatalog(); smInvalidate();
  return n;
}
async function addChapters(n, list) {
  const slug = n.slug;
  const idx = await chapterIndex(slug); let next = idx.length ? idx[idx.length - 1].num + 1 : 1;
  const saved = [];
  await fsp.mkdir(chapDir(slug), { recursive: true });
  for (const ch of list) {
    const cn = safeNum(ch.num) || next++; if (cn >= next) next = cn + 1;
    const title = String(ch.title || `Chapter ${cn}`).trim().slice(0, 300);
    const paras = Array.isArray(ch.body) ? ch.body.map(String) : splitParas(ch.body);
    if (!paras.length) continue;
    const date = new Date().toISOString();
    await fsp.writeFile(chapFile(slug, cn), JSON.stringify({ num: cn, title, date, body: paras }));
    await updateIndex(slug, cn, title, date);
    saved.push({ num: cn, title });
  }
  await refreshNovelStats(n);
  return { saved, chapters: n.chapters };
}
async function saveImage(buf, ct) {
  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[String(ct || "").split(";")[0]];
  if (!ext) throw Object.assign(new Error("Only png/jpg/webp/gif"), { status: 400 });
  const name = crypto.randomBytes(8).toString("hex") + ext;
  await fsp.writeFile(path.join(UPLOADS, name), buf);
  return "/uploads/" + name;
}

/* ---------- router ---------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = decodeURIComponent(url.pathname);
  if (req.method === "OPTIONS") return send(res, 204, "");

  // ---- API ----
  if (p.startsWith("/api/")) {
    const seg = p.split("/").filter(Boolean); // api, novels, slug, chapters, num
    if (seg[1] === "health") return send(res, 200, { ok: true, novels: catalog.length, uptime: process.uptime(), mem: process.memoryUsage().rss });
    if (seg[1] === "me") { try { const u = await requireAdmin(req); return send(res, 200, { email: u.email, admin: true, owner: !!u.owner }); } catch (e) { return send(res, e.status || 401, { admin: false, owner: false, error: e.message }); } }

    // ---- admin management (owner only) ----
    if (seg[1] === "admins") {
      const u = await requireOwner(req);
      const list = () => ({ owners: OWNERS, admins: extraAdmins });
      if (!seg[2] && req.method === "GET") return send(res, 200, list(), { "Cache-Control": "no-cache" });
      if (!seg[2] && req.method === "POST") {
        const body = await readJSON(req, 64 * 1024);
        const email = normEmail(body.email);
        if (!EMAIL_RE.test(email)) return send(res, 400, { error: "Invalid email address" });
        if (isOwner(email)) return send(res, 400, { error: "That email is already the site owner" });
        if (extraAdmins.some(a => a.email === email)) return send(res, 409, { error: "Already an admin" });
        extraAdmins.push({ email, addedBy: normEmail(u.email), addedAt: new Date().toISOString() });
        await saveAdmins();
        console.log(`[admins] ${u.email} added ${email}`);
        return send(res, 201, list());
      }
      if (seg[2] && req.method === "DELETE") {
        const email = normEmail(seg[2]);
        if (isOwner(email)) return send(res, 400, { error: "The site owner cannot be removed" });
        const before = extraAdmins.length;
        extraAdmins = extraAdmins.filter(a => a.email !== email);
        if (extraAdmins.length === before) return send(res, 404, { error: "Admin not found" });
        await saveAdmins();
        console.log(`[admins] ${u.email} removed ${email}`);
        return send(res, 200, list());
      }
      return send(res, 405, { error: "Method not allowed" });
    }

    if (seg[1] === "novels") {
      const slug = seg[2]; const sub = seg[3]; const num = seg[4];
      // GET list
      if (!slug && req.method === "GET") return send(res, 200, catalog.map(publicNovel), { "Cache-Control": "no-cache" });
      // POST create
      if (!slug && req.method === "POST") {
        await requireAdmin(req);
        const body = await readJSON(req, 2 * 1024 * 1024);
        return send(res, 201, createNovel(body));
      }
      const n = slug && bySlug(slug);
      if (!n) return send(res, 404, { error: "Novel not found" });
      if (!sub) {
        if (req.method === "GET") return send(res, 200, n);
        if (req.method === "PUT") { await requireAdmin(req); const body = await readJSON(req, 2 * 1024 * 1024); sanitizeNovel(body, n); n.updatedAt = Date.now(); saveCatalog(); smInvalidate(); return send(res, 200, n); }
        if (req.method === "DELETE") { await requireAdmin(req); catalog = catalog.filter(x => x.slug !== slug); saveCatalog(); smInvalidate(); await fsp.rm(chapDir(slug), { recursive: true, force: true }); return send(res, 200, { ok: true }); }
      }
      if (sub === "view" && req.method === "POST") { n.views = (n.views || 0) + 1; saveCatalog(); return send(res, 200, { views: n.views }); }
      if (sub === "chapters") {
        if (!num && req.method === "GET") return send(res, 200, await chapterIndex(slug), { "Cache-Control": "no-cache" });
        // POST: add one chapter {num?, title, body}  OR bulk {chapters:[{num,title,body}]}
        if (!num && req.method === "POST") {
          await requireAdmin(req);
          const body = await readJSON(req, 60 * 1024 * 1024);
          const list = Array.isArray(body.chapters) ? body.chapters : [body];
          return send(res, 201, await addChapters(n, list));
        }
        const cn = safeNum(num); if (!cn) return send(res, 400, { error: "Bad chapter number" });
        if (req.method === "GET") {
          try { const raw = await fsp.readFile(chapFile(slug, cn)); n.views = (n.views || 0) + 1; saveCatalog(); return send(res, 200, raw, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300" }); }
          catch { return send(res, 404, { error: "Chapter not found" }); }
        }
        if (req.method === "PUT") {
          await requireAdmin(req); const ch = await readJSON(req, 10 * 1024 * 1024);
          const title = String(ch.title || `Chapter ${cn}`).trim().slice(0, 300);
          const paras = Array.isArray(ch.body) ? ch.body.map(String) : splitParas(ch.body);
          let date = new Date().toISOString(); try { date = JSON.parse(await fsp.readFile(chapFile(slug, cn), "utf8")).date || date; } catch { }
          await fsp.writeFile(chapFile(slug, cn), JSON.stringify({ num: cn, title, date, body: paras }));
          await updateIndex(slug, cn, title, date); await refreshNovelStats(n);
          return send(res, 200, { ok: true });
        }
        if (req.method === "DELETE") { await requireAdmin(req); await fsp.rm(chapFile(slug, cn), { force: true }); await updateIndex(slug, cn, null); await refreshNovelStats(n); return send(res, 200, { ok: true }); }
      }
      return send(res, 405, { error: "Method not allowed" });
    }

    // cover image upload (raw bytes, Content-Type image/*) -> /uploads/<id>.<ext>
    if (seg[1] === "upload" && req.method === "POST") {
      await requireAdmin(req);
      const buf = await readBody(req, 5 * 1024 * 1024);
      return send(res, 201, { url: await saveImage(buf, req.headers["content-type"]) });
    }
    // full backup (tar-less: single JSON with everything) – admin only
    if (seg[1] === "backup" && req.method === "GET") {
      await requireAdmin(req);
      const out = { exportedAt: new Date().toISOString(), novels: [] };
      for (const n of catalog) {
        const idx = await chapterIndex(n.slug); const chapters = [];
        for (const c of idx) { try { chapters.push(JSON.parse(await fsp.readFile(chapFile(n.slug, c.num), "utf8"))); } catch { } }
        out.novels.push({ ...n, chaptersData: chapters });
      }
      const gz = zlib.gzipSync(Buffer.from(JSON.stringify(out)));
      return send(res, 200, gz, { "Content-Type": "application/gzip", "Content-Disposition": `attachment; filename="novelxplin-backup-${new Date().toISOString().slice(0, 10)}.json.gz"` });
    }
    return send(res, 404, { error: "Not found" });
  }

  // ---- SEO: robots.txt + sitemaps ----
  if (await handleSEO(req, res, p)) return;

  // ---- static files ----
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  let file = p === "/" ? "/index.html" : p;
  if (file.startsWith("/uploads/")) file = "/data" + file;
  const abs = path.normalize(path.join(ROOT, file));
  if (!abs.startsWith(ROOT) || abs.startsWith(DATA) && !abs.startsWith(UPLOADS) || abs.includes(path.sep + ".git")) return send(res, 403, "Forbidden");
  let st; try { st = await fsp.stat(abs); } catch { return send(res, 404, "Not found"); }
  if (st.isDirectory()) return send(res, 404, "Not found");
  const ext = path.extname(abs).toLowerCase();
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400" };
  const gzOk = /\bgzip\b/.test(req.headers["accept-encoding"] || "") && /^(\.html|\.js|\.css|\.svg|\.json|\.txt)$/.test(ext);
  if (gzOk) { headers["Content-Encoding"] = "gzip"; res.writeHead(200, headers); fs.createReadStream(abs).pipe(zlib.createGzip()).pipe(res); }
  else { headers["Content-Length"] = st.size; res.writeHead(200, headers); fs.createReadStream(abs).pipe(res); }
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { if (!res.headersSent) send(res, e.status || 500, { error: e.message || "Server error" }); else res.end(); if (!e.status) console.error(e); });
}).listen(PORT, "0.0.0.0", () => console.log(`Novelxplin server on http://0.0.0.0:${PORT}  (owner: ${OWNERS.join(", ")}; extra admins: ${extraAdmins.length})`));

/* ---------- Telegram upload bot (optional; enabled when TELEGRAM_BOT_TOKEN is set) ---------- */
if (process.env.TELEGRAM_BOT_TOKEN) {
  const { startBot } = require("./lib/bot");
  startBot({
    token: process.env.TELEGRAM_BOT_TOKEN,
    adminIds: process.env.TELEGRAM_ADMIN_IDS || "",
    author: process.env.BOT_AUTHOR || "Nitesh",
    siteUrl: (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, ""),
    dataDir: DATA,
    api: {
      list: async () => catalog,
      getNovel: async slug => bySlug(slug) || null,
      findByTitle: async title => catalog.find(n => n.title.toLowerCase() === String(title).toLowerCase()) || null,
      createNovel: async body => createNovel(body),
      updateNovel: async (slug, body) => { const n = bySlug(slug); if (!n) throw new Error("Novel not found"); sanitizeNovel(Object.assign({ title: n.title }, body), n); n.updatedAt = Date.now(); saveCatalog(); smInvalidate(); return n; },
      chapterIndex,
      addChapters: async (slug, list) => { const n = bySlug(slug); if (!n) throw new Error("Novel not found"); return addChapters(n, list); },
      saveImage,
    },
  });
} else console.log("Telegram bot disabled (set TELEGRAM_BOT_TOKEN to enable)");
