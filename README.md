# Novelxplin

Web-novel reading site. Admin uploads novels/chapters; readers get a fast reader with
library + reading history synced across devices via Firebase.

```
Frontend (static HTML/CSS/JS)  ──►  server.js (Node, zero deps) on Oracle VM  ──►  ./data (JSON files)
         │
         └──►  Firebase: Google login · Firestore (users/{uid}: library, history · comments)
```

Admin = any Google account listed in `js/config.js → ADMIN_EMAILS`
(currently **bhuimharniteshbhuimhar@gmail.com**). Admins see an **Admin** button in the header → `admin.html`.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home – featured, latest release, genres, top rated, latest/completed, continue reading |
| `list.html` / `genre.html` / `search.html` / `finder.html` | Browse / filter |
| `novel.html?n=<slug>` | Novel detail + chapter list (50/page, search) |
| `read.html?n=<slug>&c=<n>` | Reader – themes, font, size, keyboard nav, comments (Firestore) |
| `library.html` | Library + history (localStorage, synced to Firestore when signed in) |
| `admin.html` | **Admin only** – create/edit/delete novels, cover upload, bulk `.txt` chapter upload, backup |

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
3. **Bulk upload chapters**: drop `.txt` files.
   * One file per chapter: `chapter-1.txt`, `chapter-2.txt` … (number taken from filename; first line used as title if it looks like `Chapter 1: …`).
   * One big file: auto-split on lines like `Chapter 12: Title`, `Ch. 12`, `第12章`.
4. Or add/edit a single chapter manually. Delete / edit from the list.
5. **Download full backup** → one `.json.gz` with every novel + chapter.

## API (server.js)

```
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
RS256 signature against Google's public certs and checks the email against `ADMIN_EMAILS`.
For local dev without Firebase: `ADMIN_DEV_TOKEN=dev node server.js` and open `admin.html?dev=dev`.

## Local dev

```bash
npm run dev          # http://localhost:3000  (admin: admin.html?dev=dev)
```

## Structure

```
server.js            Node backend + static file server
js/config.js         Firebase config, admin emails, API base
js/data.js           API client (window.DB)
js/app.js            Shared UI, Firebase Auth, Lib/Auth sync (window.Lib / window.Auth)
css/style.css
admin.html           Admin panel
firestore.rules      Firestore security rules
deploy/setup-oracle.sh, deploy/backup.sh
data/                (created at runtime) catalog.json, chapters/<slug>/<n>.json, uploads/
```
