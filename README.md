# Novelxplin

Web-novel reading site. Admin uploads novels/chapters; readers get a fast reader with
library + reading history synced across devices via Firebase.

```
Frontend (static HTML/CSS/JS)  ──►  server.js (Node, zero deps) on Oracle VM  ──►  ./data (JSON files)
         │
         └──►  Firebase: Google login · Firestore (users/{uid}: library, history · comments)
```

**Owner** = the Google account(s) listed in `src/js/config.js → ADMIN_EMAILS`
(currently **bhuimharniteshbhuimhar@gmail.com**). The owner can add / remove **extra admins**
from the admin panel (“Admins” box) – just type an email and confirm. Whoever signs in with
Google using that email automatically gets the **Admin** button in the header → `admin.html`
and can upload / edit / delete novels. Extra admins are stored in `data/admins.json`
(included in backups); only the owner can manage the list.

## Pages & clean URLs

Every page has a clean, SEO-friendly path. `server.js` maps the path to the static HTML file and
injects a per-route `<title>`, meta description, canonical and Open Graph tags; `js/app.js` parses the
path back into the parameters the page needs (`window.ROUTE`) and builds links with `UI.U.*` helpers.
Old `*.html?x=` links are **301-redirected** to the clean form, so bookmarks and Google's index migrate on their own.

| Clean URL | File | Purpose |
|-----------|------|---------|
| `/` | `index.html` | Home – featured, latest release, genres, top rated, latest/completed, continue reading |
| `/latest-novels` · `/latest-release` · `/most-popular` · `/completed-novels` `[/ongoing\|/completed][/page/N]` | `list.html` | Sorted lists |
| `/genre/<genre-slug>[/ongoing\|/completed][/page/N]` | `genre.html` | Browse by genre (e.g. `/genre/martial-arts`) |
| `/search[/<term>][/page/N]` | `search.html` | Search results (`/search?q=term` also works → 302) |
| `/finder` | `finder.html` | Multi-filter novel finder |
| `/novel/<slug>[/page/N]` | `novel.html` | Novel detail + chapter list (50/page, search) + 1–5 star **user rating** (sign-in required) |
| `/novel/<slug>/chapter-<N>` | `read.html` | Reader – themes, font, size, keyboard nav, comments (Firestore) |
| `/library` | `library.html` | Library + history (localStorage, synced to Firestore when signed in) |
| `/admin[/<slug>]` | `admin.html` | **Admin only** – create/edit/delete novels, cover upload, `.epub` chapter upload, backup |
| *(anything else)* | `404.html` | Branded 404 page (HTTP 404, `noindex`) with popular novels + genres |
| Telegram bot | – | **Admin only** – upload novels from your phone: photo → details → `.epub` (see §4) |

## Anti-scraping (chapter text protection)

Chapter text is the whole product, so `GET /api/novels/:slug/chapters/:num` is guarded in `server.js` (zero deps, ~2 KB RAM per IP):

| Layer | What it stops |
|-------|---------------|
| **Page token** – every rendered page carries `<meta name="nx-t">`, an HMAC bound to the visitor's network (/24) and valid 2 h. `js/data.js` sends it as `X-NX-Token`; chapter requests without a valid one get **403**. | Scripts that just loop `chapters/1..N`; copy-pasted tokens from another machine |
| **User-agent filter** – empty / short UAs and HTTP libraries & headless browsers (`python-requests`, `curl`, `wget`, `axios`, `node-fetch`, `okhttp`, `Go-http-client`, `Headless`, `Puppeteer`, `Playwright`, `Selenium`, …) get **403** | 95 % of AI-generated dump scripts |
| **Per-IP rate limit** – `CHAPTER_LIMIT_MIN` (40/min) and `CHAPTER_LIMIT_HOUR` (500/h) → **429**; 8 violations in an hour → **1 h block** (403, logged as `[guard] blocked <ip>`) | Fast bulk download even with a real browser / valid token |
| **Same-origin CORS** – `Access-Control-Allow-Origin` is only echoed for the site's own host (was `*`). The custom header also forces a preflight. | Other websites embedding/proxying our API from the browser |
| Chapter index (`/chapters`) light limit 60/min, `Cache-Control: private` on chapter JSON | Shared caches re-serving chapter text |

Env knobs: `NX_SECRET` (HMAC key; random per boot if unset – set it so tokens survive restarts, e.g. `openssl rand -hex 32`),
`TRUST_PROXY=1` (**only** when behind Cloudflare/nginx – takes the client IP from `CF-Connecting-IP` / `X-Forwarded-For`; without it all users would share the proxy IP and hit the limit together),
`CHAPTER_LIMIT_MIN`, `CHAPTER_LIMIT_HOUR`.
If a token expires on a long-open tab, `js/data.js` silently re-reads the page to fetch a fresh one – readers never see it.

## Listen (text-to-speech) – Hindi + Indian-language neural voices

The reader's **Listen** button (`L`) opens a bottom **player card** (play/pause, prev/next paragraph,
progress track, speed chip, voice chip). Tapping the voice chip opens a **Voice & speed sheet** with
three engines, grouped voice list, speed slider and a sleep timer (15/30/60 min or "chapter end").
Default voice is **Swara (Hindi)**.

| Engine | How | Voices |
|--------|-----|--------|
| **Neural** (default) | Microsoft Edge "Read aloud" voices. Since Oct-2026 Microsoft only accepts the Edge browser itself (needs the new `Sec-MS-GEC` **v2** token + Edge User-Agent), so browsers get **403**. `lib/edgetts.js` (zero deps) speaks the protocol from the server and `GET /api/tts?voice=&rate=&q=` streams back MP3 (~50 KB / paragraph, ≈0.7 s). 10-min in-memory cache (≤6 MB), max `TTS_MAX_PARALLEL` (8) concurrent synths, 1500-char cap → safe on a 1 GB VM. | Hindi (Swara, Madhur), 4 multilingual, English India/US/UK/AU, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Urdu – 40 voices |
| **Google** | `translate.google.com/translate_tts` (what `gTTS` uses) streamed straight into `<audio>` – zero server load. ≤190-char chunks; page switches to `no-referrer`. | Hindi, English ×4, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Malayalam, Punjabi, Urdu, Nepali |
| **Device** | `speechSynthesis` built into the browser/OS | Whatever is installed (Hindi first). Offline, but may stop when the screen locks. |

Fallback chain: Neural fails → 2 quick retries → Google (same language) → Device.

Edge/Google audio plays through one shared `<audio>` element, which means:
* keeps playing with the **screen off / app in background**,
* **lock-screen & headset controls** (play/pause/next/prev paragraph) via the Media Session API, with the novel cover as artwork,
* next 2 paragraphs are pre-synthesised so there are no gaps,
* at chapter end the **next chapter is loaded in-place** (no page reload → audio session is kept) and playback continues automatically; the URL/history/reading-history are updated.

Code: `js/tts.js` (engines) + the TTS section of `js/reader.js`.

## 1. Firebase setup (5 min)

1. <https://console.firebase.google.com> → Add project `novelxplin`.
2. **Build → Authentication → Sign-in method → Google → Enable.**
   Under *Settings → Authorized domains* add your Oracle IP / domain (e.g. `144.24.114.118`).
3. **Build → Firestore Database → Create** (production mode) → *Rules* tab → paste `firestore.rules` → Publish.
4. **Project settings → Your apps → Web (</>)** → register → copy the `firebaseConfig` object
   into `src/js/config.js` (`FIREBASE: {...}`).

Without Firebase config the site still works (library/history stay in localStorage, no login).

## 2. Deploy on Oracle VM (Ubuntu, 1 GB RAM)

```bash
ssh ubuntu@144.24.114.118
git clone https://github.com/Nitesh99390/Novelxplin.git && cd Novelxplin
nano src/js/config.js          # paste Firebase config + owner email
bash deploy/setup-oracle.sh    # npm install + npm run build (src/ → dist/), Node 20, swap, systemd service, port 80 → 3000
```

Then open `http://144.24.114.118/`. In the **OCI console → VCN → Security List** add an
Ingress rule for TCP 80 (and 3000) from `0.0.0.0/0`.

| Task | Command |
|------|---------|
| Logs | `sudo journalctl -u novelxplin -f` |
| Restart | `sudo systemctl restart novelxplin` |
| Update code | `bash deploy/update.sh` (= `git pull && npm run build && sudo systemctl restart novelxplin`) |
| Backup data | `bash deploy/backup.sh` → `backups/novelxplin-data-YYYY-MM-DD.tar.gz` |

Memory footprint ≈ 50 MB RSS; chapters are streamed from disk, so 47 GB storage ≈ tens of thousands of chapters.

## 3. Uploading novels (admin)

1. Sign in with the admin Google account → click **Admin** in the header.
2. **New novel** → title, author, genres, summary, cover (upload or URL) → *Create novel*.
3. **Upload EPUB**: drop an `.epub` file (parsed in the browser with JSZip – nothing extra on the server).
   * Every spine item becomes a chapter; cover / TOC / copyright / Gutenberg boilerplate pages are skipped.
   * Title comes from the chapter's `<h1>`–`<h4>`, else the EPUB table of contents.
   * Chapter numbers are taken from headings like `Chapter 12: Title`, `Ch. 12`, `第12章` when every chapter has one; otherwise they continue from the novel's last chapter.
   * Existing chapter numbers prompt once for overwrite. Multiple `.epub` files can be dropped together (uploaded in filename order).
4. Or add/edit a single chapter manually. Delete / edit from the list.
5. **Download full backup** → one `.json.gz` with every novel + chapter.

## 4. Telegram upload bot (upload from your phone)

The server includes a zero-dependency Telegram bot. Send it a **photo → details → .epub file** and
the novel is published on the site. **Author is always `Nitesh`**; nothing else ("uploaded by",
"source") is stored.

1. In Telegram open **@BotFather → /newbot** → copy the token.
2. On the server:
   ```bash
   sudo systemctl edit novelxplin      # or edit /etc/systemd/system/novelxplin.service
   ```
   add under `[Service]`:
   ```ini
   Environment=TELEGRAM_BOT_TOKEN=123456:ABC...
   Environment=TELEGRAM_ADMIN_IDS=            # optional: your Telegram user id(s), comma separated
   Environment=SITE_URL=http://144.24.114.118
   ```
   then `sudo systemctl daemon-reload && sudo systemctl restart novelxplin`.
   (Or pass them when running `bash deploy/setup-oracle.sh`:
   `TELEGRAM_BOT_TOKEN=... bash deploy/setup-oracle.sh`.)
3. Open your bot in Telegram and press **/start**. If `TELEGRAM_ADMIN_IDS` is empty the **first**
   user who sends `/start` becomes the bot owner (saved in `data/bot.json`); everyone else is rejected.

**Usage in chat**

| Step | Send | Notes |
|---|---|---|
| 1 | Cover **photo** | caption may already contain the details |
| 2 | Details text | Any "share card" format works – emojis, bullets and markdown are stripped, keys are matched loosely (`Title/Name`, `Genre/Genres/Tags`, `Status`, `Summary/Synopsis/Description`, `Rating`, `Language`). Lines like `Author:`, `Source:`, `Chapters:`, `Uploaded by:` are **ignored** (author is always Nitesh). Genres are mapped to the site's genre list (`Fan-Fiction` → Fan-fic, `systemflow` → System, `Cultivation` → Xianxia, …) and inferred from the synopsis when none match. Language is guessed from the source/author (FanMTL / Chinese author → Chinese Novel). Plain text works too: first line = title, rest = summary |
| 3 | `.epub` or `.txt` **file** | chapters are extracted exactly like the web admin (cover/TOC pages skipped, `Chapter 12` numbering detected). Max 20 MB (Telegram limit) |

Commands: `/status` draft preview · `/new` start another novel · `/cancel` · `/list` · `/id`.
If a novel with the same title already exists the chapters are **appended** to it (send more
`.epub` files one after another for multi-volume books).

Local test: `TELEGRAM_BOT_TOKEN=... npm run dev`.

## Managing admins (owner only)

1. Sign in as the owner → **Admin** → right column **Admins** panel.
2. Type the Gmail address → **+ Add** → confirm. Done – no code change or restart needed.
3. That person signs in with Google (same email) and the Admin button appears automatically.
4. Click **✕** next to an email → confirm to revoke access instantly (server rejects their token on the next request).

The owner itself can never be removed from the panel. Extra admins **cannot** add or remove
other admins – the `/api/admins` routes require the owner's token.

## API (server.js)

```
GET    /api/me                     (admin)  {email, admin, owner}
GET    /api/admins                 (owner)  {owners:[...], admins:[{email,addedBy,addedAt}]}
POST   /api/admins                 (owner)  {email} → add admin
DELETE /api/admins/:email          (owner)  remove admin
GET    /api/novels                          catalog
GET    /api/novels/:slug                    one novel
GET    /api/novels/:slug/chapters           [{num,title,date}]
GET    /api/novels/:slug/chapters/:n        {num,title,date,body:[paras]}
GET    /api/novels/:slug/rating             {votes,rating,dist:[1★..5★],baseRating,shown,mine*}  (*mine when signed in)
POST   /api/novels/:slug/rating    (user)   {rating:1-5} → rate / change your vote
DELETE /api/novels/:slug/rating    (user)   remove your vote
POST   /api/novels                 (admin)  create
PUT    /api/novels/:slug           (admin)  update
DELETE /api/novels/:slug           (admin)  delete novel + chapters
POST   /api/novels/:slug/chapters  (admin)  {title,body} or {chapters:[...]}
PUT    /api/novels/:slug/chapters/:n (admin)
DELETE /api/novels/:slug/chapters/:n (admin)
POST   /api/upload                 (admin)  raw image body → {url}
GET    /api/backup                 (admin)  full export .json.gz
GET    /api/health
```

**User ratings**: any Google-signed-in reader can rate a novel 1–5 stars on `novel.html`
(one vote per account, changeable/removable). Votes live in `data/ratings.json`
(`{slug: {uid: {r, at}}}`, included in backups); `rating`/`votes` on each novel are the average
and count of real votes. The admin panel's **Base rating** is only displayed until the first
user vote arrives. `(user)` routes accept any valid Firebase ID token; `(admin)` routes
additionally require an admin email.

Admin requests send `Authorization: Bearer <Firebase ID token>`; the server verifies the
RS256 signature against Google's public certs and checks the email against `ADMIN_EMAILS`
(owners) **or** `data/admins.json` (extra admins added from the panel).
For local dev without Firebase: `ADMIN_DEV_TOKEN=dev node server.js` and open `/admin?dev=dev`.

## SEO: robots.txt + sitemaps (Google Search Console)

`server.js` generates everything on the fly from the catalog – nothing to regenerate or upload.

| URL | Contents |
|-----|----------|
| `/robots.txt` | Allows crawling, blocks `/admin`, `/api/`, `/library`, `/search`, legacy `*.html?` URLs; points to `/sitemap.xml` |
| `/sitemap.xml` | **Sitemap index** – submit only this one in Search Console |
| `/sitemap-pages.xml` | Home, list/sort pages, finder, and one URL per genre (`/genre/<slug>`) |
| `/sitemap-novels.xml` | One `<url>` per novel (`/novel/<slug>`) with `lastmod`, `changefreq`, `priority` and the cover as an image-sitemap entry |
| `/sitemap-chapters-<slug>.xml` | Every chapter of that novel (`/novel/<slug>/chapter-<n>`), newest 3 chapters flagged `weekly` |

* `lastmod` comes from `updatedAt` (novels) / chapter date; completed novels are `monthly`, ongoing `daily`.
* Output is cached 10 min in memory and invalidated whenever a novel/chapter is created, edited or deleted; gzip is used when the client accepts it.
* Canonical host = `PUBLIC_URL` env (set to `https://novelxplin.in` by `deploy/setup-oracle.sh`). Falls back to `SITE_URL` if it is a real domain, else the request `Host` header.
* On an existing server: `sudo systemctl edit novelxplin` → add `Environment=PUBLIC_URL=https://novelxplin.in` → `sudo systemctl daemon-reload && sudo systemctl restart novelxplin`.

**Search Console**: *Sitemaps → Add a new sitemap →* `https://novelxplin.in/sitemap.xml` → Submit.
Google reads the index and discovers all ~220 child sitemaps (and 180k+ chapter URLs) automatically.

## Advanced reader (`js/reader.js`)

`read.html` is powered by `js/reader.js` (shared `app.js`/`data.js` stay unchanged):

| Feature | How |
|---|---|
| Reading progress | 3 px bar at the top + `%` in the reader bar; scroll position is saved per chapter and restored on return |
| Focus mode | eye icon / **F** – hides header, nav, comments; tap text or **Esc** to exit |
| Auto-scroll | arrows icon / **S** – floating bar with speed 1–10 |
| Listen (TTS) | speaker icon / **L** – browser `speechSynthesis`, paragraph highlight, prev/next, speed, voice picker; click a paragraph to jump |
| 7 themes | Paper · Light · Sepia · Eye-care green · Dark · Night blue · AMOLED (**T** cycles) |
| Typography | 5 fonts (Serif, Sans, Merriweather, Lora, OpenDyslexic*), size 14–30, line-height, paragraph spacing, width 560–1200, left/justify, reset |
| Navigation | ← → keys, **swipe** left/right on phone, chapter-end card with Next/Prev + share, next chapter prefetched |
| Mobile | header + reader bar auto-hide while scrolling down, re-appear on scroll up |

\*OpenDyslexic falls back to a system font unless installed on the device. Preferences persist in `localStorage` (`nx_reader`).

## Loading skeletons

Every page loads `js/skeleton.js` **first** (before Firebase). It synchronously paints grey
shimmer placeholders into `#siteHeader` and into any element tagged `data-sk="<type>[:count]"`,
so nothing is blank while the catalog / auth requests are in flight. Page scripts simply
overwrite `innerHTML` when real data arrives.

| `data-sk` type | Used for |
|---|---|
| `featured`, `release:n`, `grid:n`, `rank:n`, `lib:n`, `genres` | Home / list panels |
| `novelhead`, `summary`, `chapters:n`, `crumb` | Novel detail |
| `nav`, `reader:n` | Reader navigation + chapter body |
| `tabs`, `filter`, `filter-opts:n`, `title`, `text:n` | Misc panels |

`window.SK.html(type, n)` returns the markup for async sections (chapter list, reader body);
`SK.clear()` removes leftovers in "not found" branches. A failsafe in `app.js` freezes the
shimmer 6 s after `app:ready` and wipes any remaining skeleton at 12 s.

## Local dev

```bash
npm run dev          # http://localhost:3000  (admin: /admin?dev=dev)
```

## Structure

```
server.js            Node backend + static file server (+ starts Telegram bot when TELEGRAM_BOT_TOKEN set)
lib/bot.js           Telegram upload bot (long polling, photo → details → epub)
lib/epub.js          Zero-dependency EPUB parser (ZIP + XHTML → chapters) used by the bot
lib/edgetts.js       Zero-dependency Edge neural TTS client (Sec-MS-GEC v2 token + RFC-6455 WebSocket) behind /api/tts
js/skeleton.js       Sync skeleton painter – fills #siteHeader + every [data-sk] before data arrives (window.SK)
src/js/config.js     Firebase config, owner email(s), API base
js/data.js           API client (window.DB)
js/app.js            Shared UI, Firebase Auth, Lib/Auth sync (window.Lib / window.Auth)
css/style.css
admin.html           Admin panel
404.html             Not-found page served for unknown routes
firestore.rules      Firestore security rules
deploy/setup-oracle.sh, deploy/backup.sh
data/                (created at runtime) catalog.json, admins.json, chapters/<slug>/<n>.json, uploads/
```

## Build system (Vite + obfuscation)

The frontend lives in `src/` and is compiled by Vite into `dist/`, which `server.js` serves.
Output is minified, split into hashed chunks (`/_nx/static/chunks/[name]-[hash].js`) and passed
through `javascript-obfuscator` (control-flow flattening, RC4/base64 string arrays, dead-code
injection, self-defending). **Never deploy `src/` directly – always `npm run build` first.**

```
src/
  *.html              page shells (one <script type="module"> each)
  css/style.css
  js/{config,data,app,skeleton,tts,reader}.js   shared modules (unchanged logic)
  js/pages/*.js       per-page logic (former inline <script> blocks)
  public/img/         copied verbatim to dist/img
vite.config.js        chunking / hashing / obfuscator settings
dist/                 build output (git-ignored) → served by server.js
```

```bash
npm install                 # installs vite + javascript-obfuscator (devDependencies)
npm run build               # src/ → dist/
npm run dev:vite            # HMR dev server on :5173 (proxies /api to :3000)
npm run deploy              # build + pm2 restart novelxplin
```

`server.js` reads static files from `dist/` (override with `STATIC_DIR=/path`).
