# Novelxplin

Web-novel reading site. Admin uploads novels/chapters; readers get a fast reader with
library + reading history synced across devices via Firebase.

```
Frontend (static HTML/CSS/JS)  ──►  server.js (Node, zero deps) on Oracle VM  ──►  ./data (JSON files)
         │
         └──►  Firebase: Google login · Firestore (users/{uid}: library, history · comments)
```

**Owner** = the Google account(s) listed in `js/config.js → ADMIN_EMAILS`
(currently **bhuimharniteshbhuimhar@gmail.com**). The owner can add / remove **extra admins**
from the admin panel (“Admins” box) – just type an email and confirm. Whoever signs in with
Google using that email automatically gets the **Admin** button in the header → `admin.html`
and can upload / edit / delete novels. Extra admins are stored in `data/admins.json`
(included in backups); only the owner can manage the list.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home – featured, latest release, genres, top rated, latest/completed, continue reading |
| `list.html` / `genre.html` / `search.html` / `finder.html` | Browse / filter |
| `novel.html?n=<slug>` | Novel detail + chapter list (50/page, search) |
| `read.html?n=<slug>&c=<n>` | Reader – themes, font, size, keyboard nav, comments (Firestore) |
| `library.html` | Library + history (localStorage, synced to Firestore when signed in) |
| `admin.html` | **Admin only** – create/edit/delete novels, cover upload, `.epub` chapter upload, backup |
| Telegram bot | **Admin only** – upload novels from your phone: photo → details → `.epub` (see §4) |

## 1. Firebase setup (5 min)

1. <https://console.firebase.google.com> → Add project `novelxplin`.
2. **Build → Authentication → Sign-in method → Google → Enable.**
   Under *Settings → Authorized domains* add your Oracle IP / domain (e.g. `144.24.114.118`).
3. **Build → Firestore Database → Create** (production mode) → *Rules* tab → paste `firestore.rules` → Publish.
4. **Project settings → Your apps → Web (</>)** → register → copy the `firebaseConfig` object
   into `js/config.js` (`FIREBASE: {...}`).

Without Firebase config the site still works (library/history stay in localStorage, no login).

## 2. Deploy on Oracle VM (Ubuntu, 1 GB RAM)

```bash
ssh ubuntu@144.24.114.118
git clone https://github.com/Nitesh99390/Novelxplin.git && cd Novelxplin
nano js/config.js              # paste Firebase config
bash deploy/setup-oracle.sh    # installs Node 20, swap, systemd service, port 80 → 3000
```

Then open `http://144.24.114.118/`. In the **OCI console → VCN → Security List** add an
Ingress rule for TCP 80 (and 3000) from `0.0.0.0/0`.

| Task | Command |
|------|---------|
| Logs | `sudo journalctl -u novelxplin -f` |
| Restart | `sudo systemctl restart novelxplin` |
| Update code | `git pull && sudo systemctl restart novelxplin` |
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
| 2 | Details text | `Title: …` / `Genres: Fantasy, Action` / `Status: Ongoing\|Completed` / `Summary: …` (multi-line ok). Plain text works too: first line = title, rest = summary |
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

Admin requests send `Authorization: Bearer <Firebase ID token>`; the server verifies the
RS256 signature against Google's public certs and checks the email against `ADMIN_EMAILS`
(owners) **or** `data/admins.json` (extra admins added from the panel).
For local dev without Firebase: `ADMIN_DEV_TOKEN=dev node server.js` and open `admin.html?dev=dev`.

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
npm run dev          # http://localhost:3000  (admin: admin.html?dev=dev)
```

## Structure

```
server.js            Node backend + static file server (+ starts Telegram bot when TELEGRAM_BOT_TOKEN set)
lib/bot.js           Telegram upload bot (long polling, photo → details → epub)
lib/epub.js          Zero-dependency EPUB parser (ZIP + XHTML → chapters) used by the bot
js/skeleton.js       Sync skeleton painter – fills #siteHeader + every [data-sk] before data arrives (window.SK)
js/config.js         Firebase config, owner email(s), API base
js/data.js           API client (window.DB)
js/app.js            Shared UI, Firebase Auth, Lib/Auth sync (window.Lib / window.Auth)
css/style.css
admin.html           Admin panel
firestore.rules      Firestore security rules
deploy/setup-oracle.sh, deploy/backup.sh
data/                (created at runtime) catalog.json, admins.json, chapters/<slug>/<n>.json, uploads/
```
