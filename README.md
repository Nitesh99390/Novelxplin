# FreeWebNovel – Frontend Clone

Web-novel reading site frontend, layout and look modelled on freewebnovel.com.
**Frontend only** – all data is mock/placeholder generated in `js/data.js`; a real backend/API can be plugged in later.

## Pages

| File | Purpose |
|------|---------|
| `index.html` | Home – featured grid, latest release list, genres sidebar, top rated, latest novels, completed novels, continue-reading |
| `list.html?sort=latest-novel\|latest-release\|most-popular\|completed` | Sorted novel lists with Ongoing/Completed tabs + pagination |
| `genre.html?g=Fantasy` | Novels by genre |
| `search.html?q=...` | Search results |
| `finder.html` | Novel Finder (multi-filter: genres, type, status, chapters, sort) |
| `novel.html?n=<slug>` | Novel detail – info, summary, chapter list (50/page, search, range select), related |
| `read.html?n=<slug>&c=<n>` | Chapter reader – prev/next, chapter select, theme (paper/light/sepia/dark), font size/family/line-height, keyboard arrows, comments (local) |
| `library.html` | Your Library + Reading history (localStorage) |

## Structure

```
css/style.css   – full theme (dark navy header, orange accent, light grey bg) + responsive
js/data.js      – mock DB (window.DB): novels, genres, chapter title/body generators, query helpers
js/app.js       – shared header/footer/login modal/toast, components (cover, stars, cards, pagination), Lib/Auth (localStorage)
img/favicon.svg
```

## Run locally

```bash
python3 -m http.server 3000
# open http://localhost:3000/index.html
```

## Backend integration (later)

Everything the UI needs comes from `window.DB` in `js/data.js`. Replace its methods
(`featured()`, `latestRelease()`, `byGenre()`, `search()`, `get()`, `chapterBody()` …) with
`fetch()` calls to your API, keep the same return shapes, and the pages will work unchanged.
`Lib` / `Auth` in `js/app.js` currently use localStorage and are the hook points for real auth/library APIs.
