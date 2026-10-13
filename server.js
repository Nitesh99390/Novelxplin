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
// Frontend is built by Vite (src/ → dist/). Static HTML/JS/CSS is served from
// dist/ (override with STATIC_DIR). Run `npm run build` before `pm2 restart`.
const STATIC = path.resolve(process.env.STATIC_DIR || path.join(ROOT, "dist"));
const DATA = path.join(ROOT, "data");
const CHAP = path.join(DATA, "chapters");
const UPLOADS = path.join(DATA, "uploads");
const CATALOG = path.join(DATA, "catalog.json");
const ADMINS_FILE = path.join(DATA, "admins.json");
const RATINGS_FILE = path.join(DATA, "ratings.json");
const PORT = +process.env.PORT || 3000;

// Owner emails (super-admins): env override or src/js/config.js. Owners can add/remove
// extra admins from the admin panel; those are persisted in data/admins.json.
let ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
let FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || "";
try {
  const cfgSrc = fs.readFileSync(path.join(ROOT, "src/js/config.js"), "utf8");
  const m = cfgSrc.match(/ADMIN_EMAILS:\s*\[([^\]]*)\]/);
  if (m && !ADMIN_EMAILS.length) ADMIN_EMAILS = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1].toLowerCase());
  const p = cfgSrc.match(/projectId:\s*"([^"]+)"/);
  if (p && !FIREBASE_PROJECT) FIREBASE_PROJECT = p[1];
} catch { }
if (!ADMIN_EMAILS.length) ADMIN_EMAILS = ["bhuimharniteshbhuimhar@gmail.com"];
if (!FIREBASE_PROJECT) console.warn("[auth] FIREBASE_PROJECT_ID not set – ID-token audience is only self-consistency checked. Set it (or projectId in src/js/config.js).");

// ADMIN_DEV_TOKEN is a LOCAL-ONLY bypass for Firebase auth. It is hard-disabled whenever
// NODE_ENV=production (or when the token is trivially short) so it can never be used – or
// leaked via the admin page's ?dev= param – against the live server.
const IS_PROD = /^prod(uction)?$/i.test(process.env.NODE_ENV || "");
const DEV_TOKEN = (() => {
  const t = String(process.env.ADMIN_DEV_TOKEN || "");
  if (!t) return "";
  if (IS_PROD) { console.warn("[auth] ADMIN_DEV_TOKEN is set but NODE_ENV=production – dev bypass DISABLED."); return ""; }
  console.warn("[auth] ADMIN_DEV_TOKEN dev bypass is ACTIVE (never run production this way).");
  return t;
})();
const isDevToken = tok => !!DEV_TOKEN && tok.length === DEV_TOKEN.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(DEV_TOKEN));

for (const d of [DATA, CHAP, UPLOADS]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(CATALOG)) fs.writeFileSync(CATALOG, "[]");
if (!fs.existsSync(ADMINS_FILE)) fs.writeFileSync(ADMINS_FILE, "[]");
if (!fs.existsSync(RATINGS_FILE)) fs.writeFileSync(RATINGS_FILE, "{}");

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
// Debounced, atomic JSON persistence. Writes never throw into the event loop (a disk error is
// logged and retried on the next change) and pending writes are flushed on shutdown.
function persister(file, getData, label) {
  let timer = null, dirty = false, writing = false;
  async function flush() {
    if (writing) { dirty = true; return; }
    writing = true; dirty = false;
    try { const tmp = file + ".tmp"; await fsp.writeFile(tmp, JSON.stringify(getData())); await fsp.rename(tmp, file); }
    catch (e) { console.error(`[persist] ${label} write failed:`, e.message); dirty = true; }
    finally { writing = false; if (dirty) { dirty = false; schedule(); } }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => { timer = null; flush().catch(() => { }); }, 150); }
  function flushSync() {
    if (!timer && !dirty) return; clearTimeout(timer); timer = null;
    try { fs.writeFileSync(file + ".tmp", JSON.stringify(getData())); fs.renameSync(file + ".tmp", file); } catch (e) { console.error(`[persist] ${label} final write failed:`, e.message); }
  }
  return { schedule, flushSync };
}
const catalogStore = persister(CATALOG, () => catalog, "catalog");
const saveCatalog = () => catalogStore.schedule();
const bySlug = s => catalog.find(n => n.slug === s);

/* ---------- user ratings (any signed-in Google user, 1 vote per user per novel) ----------
   data/ratings.json = { [slug]: { [uid]: { r: 1..5, at: ms } } }
   Novel.rating / Novel.votes are derived from these votes. When a novel has no user votes
   yet, the admin-entered "base rating" (n.baseRating, set from the admin panel / bot) is shown. */
let ratings = {};
try { ratings = JSON.parse(fs.readFileSync(RATINGS_FILE, "utf8")); if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) ratings = {}; } catch { ratings = {}; }
const ratingsStore = persister(RATINGS_FILE, () => ratings, "ratings");
const saveRatings = () => ratingsStore.schedule();
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { catalogStore.flushSync(); ratingsStore.flushSync(); try { quotaStore.flushSync(); } catch { } process.exit(0); });
process.on("unhandledRejection", e => console.error("[unhandledRejection]", e && e.message || e));
function ratingSummary(slug) {
  const votes = Object.values(ratings[slug] || {});
  const dist = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const v of votes) { const r = Math.round(+v.r); if (r >= 1 && r <= 5) { dist[r - 1]++; sum += r; } }
  const count = dist.reduce((a, b) => a + b, 0);
  return { votes: count, rating: count ? Math.round((sum / count) * 10) / 10 : 0, dist };
}
// recompute n.rating / n.votes from user votes (falls back to admin base rating)
function applyRating(n) {
  if (n.baseRating === undefined) n.baseRating = Math.max(0, Math.min(5, +n.rating || 0));
  const s = ratingSummary(n.slug);
  n.votes = s.votes;
  n.rating = s.votes ? s.rating : n.baseRating;
  return s;
}
// one-time migration for catalogs created before user ratings existed
{ let changed = false; for (const n of catalog) { if (n.baseRating === undefined) changed = true; applyRating(n); } if (changed) saveCatalog(); }
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
// _index.json is read-modify-write: serialise per slug so parallel uploads (web + Telegram bot)
// can't drop each other's titles; write atomically so a crash can't leave a half-written file.
const indexLocks = new Map(); // slug -> Promise chain
function updateIndex(slug, num, title, date) {
  const prev = indexLocks.get(slug) || Promise.resolve();
  const run = prev.catch(() => { }).then(async () => {
    const f = path.join(chapDir(slug), "_index.json");
    let idx = {}; try { idx = JSON.parse(await fsp.readFile(f, "utf8")); } catch { }
    if (title === null) delete idx[num]; else idx[num] = { t: title, d: date };
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(idx)); await fsp.rename(tmp, f);
  });
  indexLocks.set(slug, run);
  run.finally(() => { if (indexLocks.get(slug) === run) indexLocks.delete(slug); }).catch(() => { });
  return run;
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
  if (!(payload.exp > now)) throw new Error("expired");
  if (payload.iat && payload.iat > now + 300) throw new Error("issued in the future");
  if (!payload.aud || typeof payload.aud !== "string") throw new Error("no audience");
  if (FIREBASE_PROJECT && payload.aud !== FIREBASE_PROJECT) throw new Error("bad audience");
  if (payload.iss !== "https://securetoken.google.com/" + payload.aud) throw new Error("bad issuer");
  if (!payload.sub) throw new Error("no subject");
  if (!payload.email) throw new Error("no email");
  if (payload.email_verified !== true) throw new Error("email not verified");
  return payload;
}
async function requireAdmin(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw Object.assign(new Error("Login required"), { status: 401 });
  // Dev bypass: ADMIN_DEV_TOKEN env lets you test without Firebase (never in production)
  if (isDevToken(token)) return { email: OWNERS[0], dev: true, owner: true };
  let p; try { p = await verifyIdToken(token); } catch (e) { throw Object.assign(new Error("Invalid token: " + e.message), { status: 401 }); }
  if (!isAdmin(p.email)) throw Object.assign(new Error("Not an admin"), { status: 403 });
  p.owner = isOwner(p.email);
  return p;
}
// Any signed-in Google user (library/ratings). Returns { uid, email, name }.
async function requireUser(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw Object.assign(new Error("Login required"), { status: 401 });
  if (isDevToken(token)) return { uid: "dev-user", email: OWNERS[0], name: "Dev", dev: true };
  let p; try { p = await verifyIdToken(token); } catch (e) { throw Object.assign(new Error("Invalid token: " + e.message), { status: 401 }); }
  const uid = String(p.sub || p.user_id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  if (!uid) throw Object.assign(new Error("Invalid token: no uid"), { status: 401 });
  return { uid, email: p.email, name: p.name || "" };
}
// optional auth: returns user or null (never throws)
async function optionalUser(req) { try { return await requireUser(req); } catch { return null; } }
async function requireOwner(req) {
  const u = await requireAdmin(req);
  if (!u.owner) throw Object.assign(new Error("Only the site owner can manage admins"), { status: 403 });
  return u;
}

/* ---------- anti-scraping / abuse protection (zero deps) ----------
   Chapter text is the whole product, so GET /api/novels/:slug/chapters/:num is locked down:
     * X-NX-Token header (HMAC, bound to client IP /24 + 2 h window) - issued only inside the
       HTML pages we render (sendPage), so plain scripts / other sites can't just loop 1..N.
       Custom header also forces a CORS preflight -> cross-origin scraping dies there.
     * Known HTTP-library / headless user agents and empty UA are refused.
     * Per-IP sliding limits: CH_MIN chapters/min, CH_HOUR chapters/hour. Exceeding = 429;
       8 strikes in an hour = 1 h block (403). Humans never get near this, dump scripts do in seconds.
     * CORS is same-origin only (was "*").
   TRUST_PROXY=1 -> take client IP from CF-Connecting-IP / X-Forwarded-For (only when behind Cloudflare/nginx). */
const NX_SECRET = process.env.NX_SECRET || crypto.randomBytes(32).toString("hex");
const TRUST_PROXY = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY || "");
const CH_MIN = +process.env.CHAPTER_LIMIT_MIN || 40, CH_HOUR = +process.env.CHAPTER_LIMIT_HOUR || 500;
const TOKEN_WINDOW = 2 * 60 * 60 * 1000; // token lifetime
const BAD_UA = /python|curl|wget|axios|node-fetch|undici|go-http-client|okhttp|java\/|libwww|httpx|aiohttp|scrapy|requests|postman|insomnia|headless|phantom|puppeteer|playwright|selenium|http\.rb|guzzle|restsharp|powershell|dart:io|cfnetwork(?!.*safari)/i;
function clientIp(req) {
  if (TRUST_PROXY) {
    const h = req.headers["cf-connecting-ip"] || req.headers["x-real-ip"] || (req.headers["x-forwarded-for"] || "").split(",")[0];
    if (h && h.trim()) return h.trim();
  }
  return (req.socket && req.socket.remoteAddress) || "0.0.0.0";
}
// coarse network key so a phone whose IP hops inside the carrier /24 keeps its token
function ipKey(ip) {
  ip = String(ip).replace(/^::ffff:/, "");
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":");
  return ip.split(".").slice(0, 3).join(".");
}
const b64u = b => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function tokenSig(ts, key) { return b64u(crypto.createHmac("sha256", NX_SECRET).update(ts + "|" + key).digest()).slice(0, 22); }
function issueToken(req) { const ts = Date.now().toString(36); return ts + "." + tokenSig(ts, ipKey(clientIp(req))); }
function checkToken(req) {
  const t = String(req.headers["x-nx-token"] || ""); const i = t.indexOf(".");
  if (i < 1 || t.length > 64) return false;
  const ts = t.slice(0, i), sig = t.slice(i + 1); const age = Date.now() - parseInt(ts, 36);
  if (!(age >= -60000 && age < TOKEN_WINDOW)) return false;
  const exp = tokenSig(ts, ipKey(clientIp(req)));
  return sig.length === exp.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp));
}
const rl = new Map(); // ip -> { m, mt, h, ht, strikes, st, block, seen }
function rateLimit(req, perMin, perHour) {
  const ip = clientIp(req), now = Date.now();
  let e = rl.get(ip); if (!e) rl.set(ip, e = { m: 0, mt: now, h: 0, ht: now, strikes: 0, st: now, block: 0, seen: now });
  e.seen = now;
  if (e.block > now) return { ok: false, code: 403, retry: Math.ceil((e.block - now) / 1000), msg: "Too many requests - temporarily blocked" };
  if (now - e.mt > 60000) { e.m = 0; e.mt = now; }
  if (now - e.ht > 3600000) { e.h = 0; e.ht = now; }
  if (now - e.st > 3600000) { e.strikes = 0; e.st = now; }
  e.m++; e.h++;
  if (e.m > perMin || e.h > perHour) {
    if (++e.strikes >= 8) { e.block = now + 3600000; console.warn(`[guard] blocked ${ip} for 1h (chapter dump)`); }
    return { ok: false, code: 429, retry: e.m > perMin ? 60 : 900, msg: "Slow down - too many chapter requests" };
  }
  return { ok: true };
}
setInterval(() => { const cut = Date.now() - 2 * 3600000; for (const [k, v] of rl) if (v.seen < cut && v.block < Date.now()) rl.delete(k); }, 10 * 60 * 1000).unref();
function guardChapter(req) {
  const ua = String(req.headers["user-agent"] || "");
  if (!ua || ua.length < 12 || BAD_UA.test(ua)) return { code: 403, body: { error: "Forbidden" } };
  const r = rateLimit(req, CH_MIN, CH_HOUR);
  if (!r.ok) return { code: r.code, body: { error: r.msg }, headers: { "Retry-After": String(r.retry) } };
  if (!checkToken(req)) return { code: 403, body: { error: "Session expired - reload the page", code: "token" } };
  return null;
}

/* ---------- login-gated chapters + per-account quota + watermark ----------
   Catalog / search / novel pages stay public (SEO) but the chapter TEXT itself requires a
   verified Google sign-in (Firebase ID token). On top of the IP/UA guards above:
     * CHAPTER_QUOTA_DAY distinct chapters per rolling CHAPTER_QUOTA_WINDOW_H hours per uid
       (default 1000 / 24 h, same for every account). Counted per DISTINCT (slug, num) so re-opening / refreshing / TTS
       warm-up / retries of the same chapter never burn quota twice.
     * Prefetches (X-NX-Prefetch: 1) are only served when the chapter is already in the user's
       window or the quota has head-room, and they do NOT count: the chapter is only charged when
       the reader actually opens it (the real request without the prefetch header).
     * Every served chapter is watermarked with a pseudonymous id = HMAC(uid, secret) – stable per
       account, not reversible, but matchable against our own records if a dump leaks. */
const QUOTA_DAY = Math.max(1, +process.env.CHAPTER_QUOTA_DAY || 1000);
const QUOTA_WINDOW = Math.max(1, +process.env.CHAPTER_QUOTA_WINDOW_H || 24) * 3600000;
const QUOTA_FILE = path.join(DATA, "quota.json");
let quota = {}; // uid -> { [slug/num]: ms }
try { quota = JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8")); if (!quota || typeof quota !== "object") quota = {}; } catch { quota = {}; }
const quotaStore = persister(QUOTA_FILE, () => quota, "quota");
function quotaPrune(uid) {
  const e = quota[uid]; if (!e) return {};
  const cut = Date.now() - QUOTA_WINDOW; let ch = false;
  for (const k in e) if (e[k] < cut) { delete e[k]; ch = true; }
  if (!Object.keys(e).length) { delete quota[uid]; if (ch) quotaStore.schedule(); return {}; }
  if (ch) quotaStore.schedule();
  return e;
}
// returns { ok, used, limit, retry } ; charge=false only checks
function accountQuota(uid, slug, num, charge) {
  const e = quotaPrune(uid), key = slug + "/" + num, used = Object.keys(e).length;
  if (e[key]) return { ok: true, used, limit: QUOTA_DAY, seen: true };
  if (used >= QUOTA_DAY) {
    const oldest = Math.min(...Object.values(e));
    return { ok: false, used, limit: QUOTA_DAY, retry: Math.max(60, Math.ceil((oldest + QUOTA_WINDOW - Date.now()) / 1000)) };
  }
  if (charge) { (quota[uid] = quota[uid] || e)[key] = Date.now(); quotaStore.schedule(); }
  return { ok: true, used: used + (charge ? 1 : 0), limit: QUOTA_DAY };
}
setInterval(() => { for (const uid of Object.keys(quota)) quotaPrune(uid); }, 30 * 60 * 1000).unref();

// Pseudonymous watermark id: HMAC-SHA256(uid, WM_SECRET) -> 16 base32-ish chars. Same account
// always gets the same id; nobody can get the uid back out of it without the server secret.
const WM_SECRET = process.env.WM_SECRET || process.env.NX_SECRET || NX_SECRET;
const WM_ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
function watermarkId(uid) {
  const h = crypto.createHmac("sha256", WM_SECRET).update("wm|" + uid).digest();
  let s = ""; for (let i = 0; i < 16; i++) s += WM_ALPHA[h[i] % WM_ALPHA.length];
  return s;
}
// id -> zero-width string: each 5-bit symbol becomes a run of 3 zero-width chars (base-4 digits
// over ZWSP/ZWNJ/ZWJ/WJ) framed by U+2060..U+FEFF so it survives copy/paste and most scrapers.
const ZW = ["\u200B", "\u200C", "\u200D", "\u2060"];
function zwEncode(id) {
  let out = "\uFEFF";
  for (const ch of id) { let v = WM_ALPHA.indexOf(ch); if (v < 0) v = 0; out += ZW[(v >> 4) & 3] + ZW[(v >> 2) & 3] + ZW[v & 3]; }
  return out + "\uFEFF";
}
// exported for the admin / forensics: strip a leaked paragraph down to its id
function zwDecode(text) {
  const m = /\uFEFF([\u200B\u200C\u200D\u2060]{48})\uFEFF/.exec(String(text || "")); if (!m) return "";
  let s = ""; for (let i = 0; i < 48; i += 3) { const d = c => ZW.indexOf(c); s += WM_ALPHA[(d(m[1][i]) << 4) | (d(m[1][i + 1]) << 2) | d(m[1][i + 2])]; }
  return s;
}
// Inject the watermark: a zero-width copy appended to a few paragraphs chosen from the id
// itself (so two accounts' dumps differ in different places), plus explicit metadata.
function watermarkChapter(raw, wm) {
  let ch; try { ch = JSON.parse(raw); } catch { return raw; }
  const body = Array.isArray(ch.body) ? ch.body.map(String) : splitParas(ch.body);
  const z = zwEncode(wm), n = body.length;
  if (n) {
    const seed = crypto.createHash("sha256").update(wm + "|" + n).digest();
    const picks = new Set([0, n - 1]); for (let i = 0; i < 6 && n > 2; i++) picks.add(1 + (seed[i] % (n - 2)));
    const step = Math.max(3, Math.floor(n / 6)); for (let i = (seed[7] % step); i < n; i += step) picks.add(i);
    for (const i of picks) { const p = body[i]; const cut = p.length > 40 ? p.indexOf(" ", Math.floor(p.length / 2)) : -1; body[i] = cut > 0 ? p.slice(0, cut) + z + p.slice(cut) : p + z; }
  }
  ch.body = body; ch.wm = wm;
  return JSON.stringify(ch);
}
function corsHeaders(req) {
  const o = req.headers.origin; if (!o) return {};
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  let oh = ""; try { oh = new URL(o).host; } catch { }
  if (!host || oh !== host) return {};
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "Authorization, Content-Type, X-NX-Token", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Max-Age": "600", "Vary": "Origin" };
}

/* ---------- helpers ---------- */
// gzip every compressible JSON/text response ≥ 1 KB when the client accepts it (chapter JSON
// shrinks ~4×, catalog ~6×). Binary / pre-compressed bodies are passed through untouched.
const GZ_MIN = 1024;
function send(res, code, body, headers) {
  const isObj = typeof body !== "string" && !Buffer.isBuffer(body);
  let data = isObj ? JSON.stringify(body) : body;
  const h = Object.assign({ "Content-Type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" }, res.req ? corsHeaders(res.req) : {}, headers || {});
  const req = res.req;
  if (req && code === 200 && !h["Content-Encoding"] && !Buffer.isBuffer(body) && /\bgzip\b/.test(req.headers["accept-encoding"] || "") && /^(application\/json|text\/|application\/javascript|application\/xml|image\/svg)/.test(String(h["Content-Type"])) && Buffer.byteLength(data) >= GZ_MIN) {
    data = zlib.gzipSync(Buffer.from(data), { level: 6 }); h["Content-Encoding"] = "gzip";
    h.Vary = h.Vary ? h.Vary + ", Accept-Encoding" : "Accept-Encoding";
  }
  res.writeHead(code, h);
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
   /sitemap-chapters-<slug>.xml     → every chapter of one novel (/novel/<slug>/chapter-N)
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
    urlTag(`${base}/latest-novels`, today, "daily", "0.8"),
    urlTag(`${base}/latest-release`, today, "daily", "0.7"),
    urlTag(`${base}/most-popular`, today, "weekly", "0.7"),
    urlTag(`${base}/completed-novels`, today, "weekly", "0.6"),
    urlTag(`${base}/finder`, today, "weekly", "0.5"),
  ];
  const genres = [...new Set(catalog.flatMap(n => n.genres || []))].sort();
  for (const g of genres) out.push(urlTag(`${base}/genre/${slugify(g)}`, today, "weekly", "0.6"));
  return SM_HEAD + URLSET_OPEN + out.join("\n") + `\n</urlset>\n`;
}
function buildNovelsSitemap(base) {
  const out = catalog.map(n => {
    const img = n.cover ? `    <image:image>\n      <image:loc>${xmlEsc(/^https?:/i.test(n.cover) ? n.cover : base + n.cover)}</image:loc>\n      <image:title>${xmlEsc(n.title)}</image:title>\n    </image:image>` : "";
    const freq = n.status === "Completed" ? "monthly" : "daily";
    const pri = n.hot ? "0.9" : "0.8";
    return urlTag(`${base}/novel/${encodeURIComponent(n.slug)}`, isoDate(n.updatedAt), freq, pri, img);
  });
  return SM_HEAD + URLSET_OPEN + out.join("\n") + `\n</urlset>\n`;
}
async function buildChaptersSitemap(base, n) {
  const list = await chapterIndex(n.slug);
  const freq = n.status === "Completed" ? "yearly" : "monthly";
  const out = list.map((c, i) => {
    const isLatest = i >= list.length - 3;
    return urlTag(`${base}/novel/${encodeURIComponent(n.slug)}/chapter-${c.num}`, isoDate(c.date ? Date.parse(c.date) : n.updatedAt), isLatest ? "weekly" : freq, isLatest ? "0.6" : "0.5");
  });
  return SM_HEAD + URLSET_OPEN + out.join("\n") + `\n</urlset>\n`;
}
function buildRobots(base) {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /admin.html",
    "Disallow: /api/",
    "Disallow: /library",
    "Disallow: /library.html",
    "Disallow: /search",
    "Disallow: /search.html",
    "Disallow: /*.html?",
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

/* ---------- Clean URL routing ----------
   Pretty paths are served by the same static HTML files; the frontend (js/app.js)
   parses the path back into its parameters.  Legacy "*.html?n=…" URLs get a 301
   to the clean form so old links / Google index migrate automatically.

     /                                   index.html
     /novel/<slug>[/page/N]              novel.html      (was novel.html?n=&page=)
     /novel/<slug>/chapter-<N>           read.html       (was read.html?n=&c=)
     /genre/<genre>[/<status>][/page/N]  genre.html      (was genre.html?g=)
     /latest-novels /latest-release /most-popular /completed-novels [/<status>][/page/N]
                                         list.html       (was list.html?sort=)
     /search[/<term>][/page/N]           search.html     (was search.html?q=)
     /library  /finder  /admin[/<slug>]  library.html finder.html admin.html
*/
const LIST_PATHS = { "latest-novel": "latest-novels", "latest-release": "latest-release", "most-popular": "most-popular", "completed": "completed-novels" };
const PATH_SORTS = Object.fromEntries(Object.entries(LIST_PATHS).map(([k, v]) => [v, k]));
const PATH_PAGES = new Set(["library", "finder", "admin"]);
const SITE_NAME = "Novelxplin";
const SITE_DESC = "Read web novels online for free – fast reader, library and reading history synced across devices.";
const htmlEsc = xmlEsc;
const pgSeg = p => p && +p > 1 ? `/page/${+p}` : "";
const stSeg = s => s && /^(ongoing|completed)$/i.test(s) ? `/${s.toLowerCase()}` : "";
const genreSlugName = s => { const k = slugify(s); return [...new Set(catalog.flatMap(n => n.genres || []))].find(g => slugify(g) === k) || null; };
const titleCase = s => String(s).split("-").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

// Legacy *.html URL  →  clean path (or null when it is already clean / unknown)
function legacyToClean(p, sp) {
  const file = p.replace(/^\//, "");
  const n = sp.get("n"), page = sp.get("page"), status = sp.get("status");
  switch (file) {
    case "index.html": return "/";
    case "novel.html": return n ? `/novel/${encodeURIComponent(n)}${pgSeg(page)}` : "/latest-novels";
    case "read.html": return n ? `/novel/${encodeURIComponent(n)}/chapter-${safeNum(sp.get("c")) || 1}` : "/latest-novels";
    case "genre.html": { const g = sp.get("g"); return g ? `/genre/${slugify(g)}${stSeg(status)}${pgSeg(page)}` : "/latest-novels"; }
    case "list.html": return `/${LIST_PATHS[sp.get("sort")] || "latest-novels"}${stSeg(status)}${pgSeg(page)}`;
    case "search.html": { const q = (sp.get("q") || "").trim(); return `/search${q ? "/" + encodeURIComponent(q) : ""}${pgSeg(page)}`; }
    case "library.html": return "/library";
    case "finder.html": return "/finder";
    case "admin.html": return `/admin${n ? "/" + encodeURIComponent(n) : ""}${sp.get("dev") ? "?dev=" + encodeURIComponent(sp.get("dev")) : ""}`;
  }
  return null;
}

// Clean path → { file, title, desc, canonical, robots } or null (= not a page route)
// Takes the RAW (still percent-encoded) pathname: segments are decoded one by one so a search
// term containing "/" (%2F) stays a single segment, and a malformed %xx yields 404 instead of 500.
const decSeg = s => { try { return decodeURIComponent(s); } catch { return s; } };
function resolveRoute(rawPath, base) {
  const seg = rawPath.split("/").filter(Boolean).map(decSeg);
  let page = 1;
  if (seg.length >= 2 && seg[seg.length - 2] === "page" && /^\d+$/.test(seg[seg.length - 1])) { page = +seg.pop(); seg.pop(); }
  const [a, b, c] = seg;
  const stTxt = s => s === "completed" ? "Completed " : s === "ongoing" ? "Ongoing " : "";
  const sfx = page > 1 ? ` – Page ${page}` : "";
  const R = (file, title, desc, canon, robots) => ({ file, title: `${title} - ${SITE_NAME}`, desc: desc || SITE_DESC, canonical: base + canon, robots });
  if (!a) return R("index.html", "Read Web Novels Online Free", SITE_DESC, "/");
  if (a === "novel" && b) {
    const n = bySlug(b); if (!n) return { file: "novel.html", status: 404, title: `Novel not found - ${SITE_NAME}`, desc: SITE_DESC, robots: "noindex" };
    const m = c && /^chapter-(\d+)$/.exec(c);
    const summ = Array.isArray(n.summary) ? n.summary.join(" ") : String(n.summary || "");
    const desc = (summ || `Read ${n.title} by ${n.author || "Unknown"} online. ${n.chapters} chapters, ${n.status}.`).replace(/\s+/g, " ").slice(0, 160);
    if (m) {
      if (seg.length !== 3) return null;
      const num = +m[1];
      return R("read.html", `${n.title} – Chapter ${num}`, `Read ${n.title} Chapter ${num} online for free on ${SITE_NAME}.`, `/novel/${encodeURIComponent(n.slug)}/chapter-${num}`);
    }
    if (seg.length !== 2) return null;
    return R("novel.html", `${n.title}${sfx}`, desc, `/novel/${encodeURIComponent(n.slug)}${pgSeg(page)}`);
  }
  if (a === "genre" && b && seg.length <= 3) {
    if (c && !/^(ongoing|completed)$/.test(c)) return null;
    const g = genreSlugName(b) || titleCase(b);
    return R("genre.html", `${stTxt(c)}${g} Novels${sfx}`, `Browse ${g.toLowerCase()} web novels – ${stTxt(c).toLowerCase()}titles sorted by latest update.`, `/genre/${slugify(b)}${stSeg(c)}${pgSeg(page)}`);
  }
  if (PATH_SORTS[a] && seg.length <= 2) {
    if (b && !/^(ongoing|completed)$/.test(b)) return null;
    const names = { "latest-novels": "Latest Novels", "latest-release": "Latest Release Novels", "most-popular": "Most Popular Novels", "completed-novels": "Completed Novels" };
    return R("list.html", `${stTxt(b)}${names[a]}${sfx}`, `${names[a]} on ${SITE_NAME} – ${SITE_DESC}`, `/${a}${stSeg(b)}${pgSeg(page)}`);
  }
  if (a === "search" && seg.length <= 3) {
    if (c && !/^(ongoing|completed)$/.test(c)) return null; // /search/<term>/<ongoing|completed>
    return R("search.html", b ? `${stTxt(c)}Search: ${b}${sfx}` : "Search", SITE_DESC, `/search${b ? "/" + encodeURIComponent(b) : ""}${stSeg(c)}${pgSeg(page)}`, "noindex");
  }
  if (PATH_PAGES.has(a) && (seg.length === 1 || (a === "admin" && seg.length === 2))) {
    const t = { library: "Your Library", finder: "Novel Finder", admin: "Admin" }[a];
    return R(`${a}.html`, t, SITE_DESC, `/${a}`, a === "finder" ? undefined : "noindex");
  }
  return null;
}

// Automatic cache-busting for our own /js and /css files: the `?v=` in the HTML is
// rewritten to a hash of the asset's size+mtime, so every deploy gets a fresh URL and
// browsers / Cloudflare can never keep serving a stale app.js against new HTML
// (that mismatch left the home page stuck on skeletons – "reading 'novel'" error).
const assetVer = new Map(); // "/js/app.js" -> { exp, v }
async function assetVersion(p) {
  const hit = assetVer.get(p);
  if (hit && hit.exp > Date.now()) return hit.v;
  let v = null;
  try { const st = await fsp.stat(path.join(STATIC, p)); v = crypto.createHash("md5").update(`${st.size}:${Math.round(st.mtimeMs)}`).digest("hex").slice(0, 10); } catch { }
  assetVer.set(p, { exp: Date.now() + 10000, v });
  return v;
}
const ASSET_RE = /((?:href|src)=")(\/(?:js|css)\/[\w.-]+\.(?:js|css))(?:\?v=[^"]*)?(")/g;
async function versionAssets(html) {
  const paths = [...new Set([...html.matchAll(ASSET_RE)].map(m => m[2]))];
  const vers = Object.fromEntries(await Promise.all(paths.map(async p => [p, await assetVersion(p)])));
  return html.replace(ASSET_RE, (m, a, p, z) => vers[p] ? `${a}${p}?v=${vers[p]}${z}` : m);
}

// Serve an HTML page with per-route <title>, description, canonical + og tags injected.
const htmlCache = new Map(); // file -> { mtime, body }
async function sendPage(req, res, r) {
  const abs = path.join(STATIC, r.file);
  let st; try { st = await fsp.stat(abs); } catch { return send(res, 404, "Not found"); }
  let hit = htmlCache.get(r.file);
  if (!hit || hit.mtime !== st.mtimeMs) { hit = { mtime: st.mtimeMs, body: await fsp.readFile(abs, "utf8") }; htmlCache.set(r.file, hit); }
  const meta = [
    `<title>${htmlEsc(r.title)}</title>`,
    `<meta name="description" content="${htmlEsc(r.desc)}">`,
    r.canonical ? `<link rel="canonical" href="${htmlEsc(r.canonical)}">` : "",
    r.robots ? `<meta name="robots" content="${r.robots}">` : "",
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${htmlEsc(r.title)}">`,
    `<meta property="og:description" content="${htmlEsc(r.desc)}">`,
    r.canonical ? `<meta property="og:url" content="${htmlEsc(r.canonical)}">` : "",
    `<meta name="nx-t" content="${issueToken(req)}">`,
  ].filter(Boolean).join("\n  ");
  // drop any static description/robots/canonical tags so the per-route ones win (no duplicates)
  let html = hit.body
    .replace(/[ \t]*<meta\s+name="(description|robots)"[^>]*>\s*\n?/gi, "")
    .replace(/[ \t]*<link\s+rel="canonical"[^>]*>\s*\n?/gi, "");
  html = /<title>/i.test(html) ? html.replace(/<title>[\s\S]*?<\/title>/i, meta) : html.replace(/<head>/i, `<head>\n  ${meta}`);
  html = await versionAssets(html);
  const buf = Buffer.from(html);
  const headers = { "Content-Type": MIME[".html"], "Cache-Control": "no-cache" };
  if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) { headers["Content-Encoding"] = "gzip"; return send(res, r.status || 200, zlib.gzipSync(buf), headers); }
  return send(res, r.status || 200, buf, headers);
}

// Unknown path: HTML 404 page for browsers, plain text otherwise.
async function notFound(req, res) {
  if (!/text\/html/.test(req.headers.accept || "")) return send(res, 404, "Not found");
  return sendPage(req, res, { file: "404.html", status: 404, title: `Page not found - ${SITE_NAME}`, desc: SITE_DESC, robots: "noindex" });
}

// Returns true when the request was handled (redirect or page), false → fall through to static files.
// `p` is the decoded path (legacy *.html + static lookups), `url.pathname` the raw one (routes).
async function handleRoutes(req, res, p, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  // 1) legacy *.html → 301 to clean URL
  if (/^\/[a-z]+\.html$/i.test(p)) {
    const to = legacyToClean(p, url.searchParams);
    if (to) { send(res, 301, "", { Location: to, "Cache-Control": "no-cache" }); return true; }
  }
  // 2) trailing slash / uppercase normalisation (except root)
  if (p.length > 1 && p.endsWith("/")) { send(res, 301, "", { Location: p.replace(/\/+$/, "") + url.search }); return true; }
  // 3) clean routes
  const r = resolveRoute(url.pathname, siteBase(req));
  if (!r) return false;
  // /search?q=term (plain form submit without JS) → /search/term
  if (r.file === "search.html" && url.searchParams.get("q") && p === "/search") {
    const q = url.searchParams.get("q").trim();
    send(res, 302, "", { Location: `/search${q ? "/" + encodeURIComponent(q) : ""}` }); return true;
  }
  await sendPage(req, res, r); return true;
}

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
  // admin-entered rating = base rating; shown until real users have voted
  if (body.rating !== undefined || body.baseRating !== undefined) {
    n.baseRating = Math.max(0, Math.min(5, +(body.baseRating !== undefined ? body.baseRating : body.rating) || 0));
    if (n.slug) applyRating(n); else n.rating = n.baseRating;
  }
  if (body.color !== undefined) n.color = String(body.color || "").slice(0, 20);
  if (body.glyph !== undefined) n.glyph = String(body.glyph || "").slice(0, 4);
  return n;
}

/* ---------- shared write operations (used by HTTP API + Telegram bot) ---------- */
function createNovel(body) {
  const n = sanitizeNovel(body);
  let s = slugify(body.slug || n.title) || "novel"; let base = s, i = 2; while (bySlug(s)) s = `${base}-${i++}`;
  Object.assign(n, { slug: s, chapters: 0, views: 0, votes: 0, latest: null, createdAt: Date.now(), updatedAt: Date.now() });
  n.baseRating = Math.max(0, Math.min(5, +n.baseRating || +n.rating || 0)); n.rating = n.baseRating; n.genres = n.genres && n.genres.length ? n.genres : ["Fantasy"]; n.lang = n.lang || "English Novel"; n.status = n.status || "Ongoing"; n.summary = n.summary || [];
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
  let p; try { p = decodeURIComponent(url.pathname); } catch { p = url.pathname; } // malformed %xx → plain 404, not 500
  res.req = req;
  if (req.method === "OPTIONS") return send(res, 204, "");

  // ---- API ----
  if (p.startsWith("/api/")) {
    const seg = p.split("/").filter(Boolean); // api, novels, slug, chapters, num
    if (seg[1] === "health") return send(res, 200, { ok: true, novels: catalog.length, uptime: process.uptime(), mem: process.memoryUsage().rss });
    if (seg[1] === "me") { try { const u = await requireAdmin(req); return send(res, 200, { email: u.email, admin: true, owner: !!u.owner }); } catch (e) { return send(res, e.status || 401, { admin: false, owner: false, error: e.message }); } }
    // Owner-only forensics: POST {text} -> { wm } decodes a leaked paragraph's zero-width mark;
    // POST {uid} -> { wm } gives the id a given account would produce (to match against a leak).
    if (seg[1] === "watermark" && req.method === "POST") {
      await requireOwner(req); const b = await readJSON(req, 2 * 1024 * 1024);
      if (b.uid) return send(res, 200, { wm: watermarkId(String(b.uid).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128)) });
      return send(res, 200, { wm: zwDecode(b.text) || null });
    }

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
        if (req.method === "DELETE") { await requireAdmin(req); catalog = catalog.filter(x => x.slug !== slug); delete ratings[slug]; saveRatings(); saveCatalog(); smInvalidate(); await fsp.rm(chapDir(slug), { recursive: true, force: true }); return send(res, 200, { ok: true }); }
      }
      // ---- user ratings: GET summary (+ my vote when signed in) · POST {rating:1-5} · DELETE my vote ----
      if (sub === "rating") {
        const summary = u => Object.assign(ratingSummary(slug), { baseRating: n.baseRating || 0, shown: n.rating, mine: u && ratings[slug] && ratings[slug][u.uid] ? ratings[slug][u.uid].r : 0 });
        if (req.method === "GET") return send(res, 200, summary(await optionalUser(req)), { "Cache-Control": "no-cache" });
        if (req.method === "POST") {
          const u = await requireUser(req);
          const body = await readJSON(req, 16 * 1024);
          const r = Math.round(+body.rating);
          if (!(r >= 1 && r <= 5)) return send(res, 400, { error: "Rating must be 1-5" });
          (ratings[slug] = ratings[slug] || {})[u.uid] = { r, at: Date.now() };
          applyRating(n); saveRatings(); saveCatalog();
          return send(res, 200, summary(u));
        }
        if (req.method === "DELETE") {
          const u = await requireUser(req);
          if (ratings[slug] && ratings[slug][u.uid]) { delete ratings[slug][u.uid]; if (!Object.keys(ratings[slug]).length) delete ratings[slug]; }
          applyRating(n); saveRatings(); saveCatalog();
          return send(res, 200, summary(u));
        }
        return send(res, 405, { error: "Method not allowed" });
      }
      // One view = one chapter actually opened by a reader. The reader page POSTs this once per
      // chapter shown; chapter GETs themselves do NOT count (they also fire for prefetch, TTS
      // warm-up and retries, which used to double/triple the numbers). Needs the page token so
      // plain scripts can't inflate it; without one we still answer 200 but don't count.
      if (sub === "view" && req.method === "POST") {
        const r = rateLimit(req, 60, 1500); if (!r.ok) return send(res, r.code, { error: r.msg }, { "Retry-After": String(r.retry) });
        if (checkToken(req)) { n.views = (n.views || 0) + 1; saveCatalog(); }
        return send(res, 200, { views: n.views || 0 });
      }
      if (sub === "chapters") {
        if (!num && req.method === "GET") { const r = rateLimit(req, 60, 1200); if (!r.ok) return send(res, r.code, { error: r.msg }, { "Retry-After": String(r.retry) }); return send(res, 200, await chapterIndex(slug), { "Cache-Control": "no-cache" }); }
        // POST: add one chapter {num?, title, body}  OR bulk {chapters:[{num,title,body}]}
        if (!num && req.method === "POST") {
          await requireAdmin(req);
          const body = await readJSON(req, 60 * 1024 * 1024);
          const list = Array.isArray(body.chapters) ? body.chapters : [body];
          return send(res, 201, await addChapters(n, list));
        }
        const cn = safeNum(num); if (!cn) return send(res, 400, { error: "Bad chapter number" });
        if (req.method === "GET") {
          const g = guardChapter(req); if (g) return send(res, g.code, g.body, g.headers);
          // login gate: a verified Google account is required to read chapter text
          let u; try { u = await requireUser(req); } catch (e) { return send(res, 401, { error: "Sign in with Google to read chapters", code: "login" }, { "WWW-Authenticate": "Bearer realm=\"novelxplin\"", "Cache-Control": "no-store" }); }
          const prefetch = /^(1|true)$/i.test(String(req.headers["x-nx-prefetch"] || ""));
          const qr = accountQuota(u.uid, slug, cn, !prefetch);
          if (!qr.ok) {
            if (prefetch) return send(res, 429, { error: "Prefetch skipped - daily quota reached", code: "quota", used: qr.used, limit: qr.limit }, { "Retry-After": String(qr.retry), "Cache-Control": "no-store" });
            console.warn(`[quota] ${u.uid.slice(0, 8)}… (${u.email}) hit ${qr.limit} chapters / ${QUOTA_WINDOW / 3600000}h`);
            return send(res, 429, { error: `Daily reading limit reached (${qr.limit} chapters per ${QUOTA_WINDOW / 3600000} hours). Please come back later.`, code: "quota", used: qr.used, limit: qr.limit, retry: qr.retry }, { "Retry-After": String(qr.retry), "Cache-Control": "no-store" });
          }
          const wm = watermarkId(u.uid);
          try { const raw = await fsp.readFile(chapFile(slug, cn), "utf8"); return send(res, 200, watermarkChapter(raw, wm), { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "Vary": "Authorization, X-NX-Token", "X-NX-Quota": `${qr.used}/${qr.limit}`, "X-NX-WM": wm }); }
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
      const out = { exportedAt: new Date().toISOString(), ratings, novels: [] };
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

  // ---- clean URL routes + legacy redirects ----
  if (await handleRoutes(req, res, p, url)) return;

  // ---- static files ----
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  let file = p === "/" ? "/index.html" : p;
  // user uploads live in data/uploads (outside the Vite build); everything else comes from dist/
  const isUpload = file.startsWith("/uploads/");
  const abs = isUpload ? path.normalize(path.join(UPLOADS, file.slice("/uploads/".length))) : path.normalize(path.join(STATIC, file));
  if (isUpload ? !abs.startsWith(UPLOADS + path.sep) : !abs.startsWith(STATIC + path.sep) || abs.includes(path.sep + ".git")) return send(res, 403, "Forbidden");
  let st; try { st = await fsp.stat(abs); } catch { return notFound(req, res); }
  if (st.isDirectory()) return notFound(req, res);
  const ext = path.extname(abs).toLowerCase();
  // Vite output under /_nx/static/ is content-hashed → cache forever (immutable). HTML is always
  // revalidated (it carries the per-visitor nx-t token); everything else (uploads, favicon) 1 day.
  const immutable = file.startsWith("/_nx/static/");
  const headers = { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : immutable ? "public, max-age=31536000, immutable" : "public, max-age=86400", "Vary": "Accept-Encoding" };
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`; headers.ETag = etag; headers["Last-Modified"] = st.mtime.toUTCString();
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
  const gzOk = /\bgzip\b/.test(req.headers["accept-encoding"] || "") && /^(\.html|\.js|\.css|\.svg|\.json|\.txt)$/.test(ext);
  if (gzOk) { headers["Content-Encoding"] = "gzip"; res.writeHead(200, headers); fs.createReadStream(abs).pipe(zlib.createGzip({ level: 6 })).pipe(res); }
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
