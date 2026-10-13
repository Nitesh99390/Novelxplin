/* =========================================================
   Novelxplin Telegram upload bot (zero dependencies, long polling).

   Flow for the admin in Telegram:
     1. send the cover PHOTO (caption may already contain the details)
     2. send the DETAILS as text:
            Title: My Novel
            Genres: Fantasy, Action
            Status: Ongoing | Completed
            Summary: ...multi-line...
     3. send the .epub (or .txt) FILE  → chapters are extracted and
        the novel goes live on the website.  Author is always "Nitesh".

   Env: TELEGRAM_BOT_TOKEN  (required – from @BotFather)
        TELEGRAM_ADMIN_IDS  (optional, comma separated Telegram user ids;
                             if empty the first user who sends /start is
                             saved as owner in data/bot.json)
        BOT_AUTHOR          (default "Nitesh")
        SITE_URL            (public URL used in the "done" message)
   ========================================================= */
const https = require("https");
const fs = require("fs");
const path = require("path");
const { parseEpub } = require("./epub");

function startBot(opts) {
  const { token, api, dataDir, siteUrl, log = console.log } = opts;
  const AUTHOR = opts.author || "Nitesh";
  const BOT_FILE = path.join(dataDir, "bot.json");
  let store = { owners: [], chats: {} };
  try { store = Object.assign(store, JSON.parse(fs.readFileSync(BOT_FILE, "utf8"))); } catch { }
  const envIds = String(opts.adminIds || "").split(",").map(s => s.trim()).filter(Boolean).map(Number);
  const allowed = id => envIds.includes(id) || store.owners.includes(id);
  const save = () => { try { fs.writeFileSync(BOT_FILE, JSON.stringify(store, null, 2)); } catch (e) { log("[bot] save failed", e.message); } };

  /* ---------- Telegram helpers ---------- */
  const TG = `https://api.telegram.org/bot${token}`;
  function tg(method, body) {
    return new Promise((res, rej) => {
      const data = JSON.stringify(body || {});
      const r = https.request(`${TG}/${method}`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }, timeout: 70000 }, resp => {
        let b = ""; resp.on("data", d => b += d); resp.on("end", () => { try { const j = JSON.parse(b); j.ok ? res(j.result) : rej(new Error(j.description || "telegram error")); } catch (e) { rej(e); } });
      });
      r.on("error", rej); r.on("timeout", () => r.destroy(new Error("timeout"))); r.end(data);
    });
  }
  function download(url, limit) {
    return new Promise((res, rej) => https.get(url, r => {
      if (r.statusCode === 301 || r.statusCode === 302) return download(r.headers.location, limit).then(res, rej);
      if (r.statusCode !== 200) return rej(new Error("download failed " + r.statusCode));
      const chunks = []; let size = 0;
      r.on("data", c => { size += c.length; if (size > limit) { r.destroy(); rej(new Error("file too large")); } else chunks.push(c); });
      r.on("end", () => res(Buffer.concat(chunks))); r.on("error", rej);
    }).on("error", rej));
  }
  async function tgFile(fileId, limit) {
    const f = await tg("getFile", { file_id: fileId });
    return download(`https://api.telegram.org/file/bot${token}/${f.file_path}`, limit || 20 * 1024 * 1024);
  }
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const say = (chat, html, extra) => tg("sendMessage", Object.assign({ chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true }, extra || {})).catch(e => log("[bot] send failed:", e.message));

  /* ---------- per-chat draft state ---------- */
  const drafts = {}; // chatId -> { cover, title, genres, status, summary, rating, lang, step }
  const draft = id => drafts[id] || (drafts[id] = {});
  const reset = id => { delete drafts[id]; };

  /* ---------- smart details parser ----------
     Understands "share card" style captions such as
        🆕 New Webnovel Upload!
        📖 Title: Naruto's strongest all-round system
        👤 Author: 别听雨说          ← ignored (author is always Nitesh)
        🌐 Source: FanMTL           ← ignored
        🎭 Genre: Fan-Fiction, Naruto, systemflow
        📊 Status: Completed
        📚 Chapters: 387            ← ignored (counted from the file)
        👥 Uploaded by: ID: 123     ← ignored
        📄 Synopsis: ...multi-line...
     Emojis / bullets / markdown are stripped, keys are matched loosely,
     genres are normalised to the site's genre list, language is guessed. */
  const SITE_GENRES = ["Action", "Adult", "Adventure", "Comedy", "Drama", "Eastern", "Ecchi", "Fan-fic", "Fantasy", "Game", "Gender Bender", "Harem", "Historical", "Horror", "Josei", "Martial Arts", "Mature", "Mecha", "Mystery", "Psychological", "Reincarnation", "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo", "Shounen Ai", "Shounen", "Slice of Life", "Smut", "Sports", "Supernatural", "System", "Tragedy", "Wuxia", "Xianxia", "Xuanhuan", "Yaoi"];
  const GENRE_ALIAS = {
    fanfic: "Fan-fic", fanfiction: "Fan-fic", fanfictions: "Fan-fic", fan: "Fan-fic", doujin: "Fan-fic", crossover: "Fan-fic", cross: "Fan-fic", anime: "Fan-fic", naruto: "Fan-fic", onepiece: "Fan-fic", marvel: "Fan-fic", dc: "Fan-fic", pokemon: "Fan-fic", harrypotter: "Fan-fic", comprehensive: "Fan-fic", comprehensiveanime: "Fan-fic",
    system: "System", systemflow: "System", systems: "System", cheat: "System", goldfinger: "System",
    scifi: "Sci-fi", sciencefiction: "Sci-fi", sf: "Sci-fi", future: "Sci-fi", cyberpunk: "Sci-fi", apocalypse: "Sci-fi", postapocalyptic: "Sci-fi", interstellar: "Sci-fi",
    martialart: "Martial Arts", martial: "Martial Arts", cultivation: "Xianxia", immortal: "Xianxia", immortalcultivation: "Xianxia", xianxia: "Xianxia", xuanhuan: "Xuanhuan", wuxia: "Wuxia", eastern: "Eastern", easternfantasy: "Xuanhuan",
    reincarnated: "Reincarnation", rebirth: "Reincarnation", reborn: "Reincarnation", transmigration: "Reincarnation", transmigrated: "Reincarnation", isekai: "Reincarnation", timetravel: "Reincarnation",
    sliceoflife: "Slice of Life", schoollife: "School Life", school: "School Life", campus: "School Life", genderbender: "Gender Bender", shounenai: "Shounen Ai", shonen: "Shounen", shonenai: "Shounen Ai", shojo: "Shoujo",
    adventures: "Adventure", actions: "Action", romantic: "Romance", love: "Romance", comedic: "Comedy", humor: "Comedy", funny: "Comedy", dramatic: "Drama", mystery: "Mystery", detective: "Mystery", thriller: "Mystery", suspense: "Mystery", horror: "Horror", supernatural: "Supernatural", magic: "Fantasy", magical: "Fantasy", fantasy: "Fantasy", highfantasy: "Fantasy", urban: "Supernatural", urbanfantasy: "Supernatural", modern: "Supernatural",
    games: "Game", gaming: "Game", vrmmo: "Game", litrpg: "Game", videogames: "Game", esports: "Game", mecha: "Mecha", robots: "Mecha", sport: "Sports", basketball: "Sports", football: "Sports", history: "Historical", historical: "Historical", psychological: "Psychological", tragedy: "Tragedy", tragic: "Tragedy", mature: "Mature", adult: "Adult", r18: "Adult", ecchi: "Ecchi", smut: "Smut", harem: "Harem", yaoi: "Yaoi", bl: "Yaoi", josei: "Josei", seinen: "Seinen"
  };
  const gkey = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const GENRE_INDEX = Object.fromEntries(SITE_GENRES.map(g => [gkey(g), g]));
  function normalizeGenres(raw) {
    const out = [];
    const push = g => { if (g && !out.includes(g)) out.push(g); };
    for (const part of String(raw || "").split(/[,，、/|;•·\n]+|\s{2,}/)) {
      const k = gkey(part.replace(/^#/, ""));
      if (!k) continue;
      const hit = GENRE_INDEX[k] || GENRE_ALIAS[k] || GENRE_INDEX[k.replace(/s$/, "")] || GENRE_ALIAS[k.replace(/s$/, "")];
      if (hit) push(hit);
    }
    return out.slice(0, 8);
  }
  // infer extra genres from title + summary when the caption gave few/no usable ones
  function inferGenres(d) {
    const txt = `${d.title || ""} ${d.summary || ""}`.toLowerCase();
    const g = [];
    const rules = [[/\bsystem\b/, "System"], [/naruto|one piece|marvel|pokemon|hogwarts|harry potter|dragon ball|crossover|fan ?fic/, "Fan-fic"], [/cultivat|immortal|dao\b|sect\b/, "Xianxia"], [/reincarnat|transmigrat|rebirth|reborn|isekai|travel(l)?ed to/, "Reincarnation"], [/martial art/, "Martial Arts"], [/\bvr\b|game world|player|level up|dungeon/, "Game"], [/romance|love story|wife|girlfriend/, "Romance"], [/apocalyp|zombie|interstellar|space ship|mech/, "Sci-fi"], [/school|campus|academy/, "School Life"], [/harem/, "Harem"], [/urban|modern city/, "Supernatural"]];
    for (const [re, name] of rules) if (re.test(txt) && !g.includes(name)) g.push(name);
    return g;
  }
  function guessLang(d, author) {
    const s = `${author || ""} ${d.source || ""}`;
    if (/[\u3040-\u30ff]/.test(s)) return "Japanese Novel";
    if (/[\uac00-\ud7af]/.test(s)) return "Korean Novel";
    if (/[\u4e00-\u9fff]/.test(s) || /fanmtl|mtl|qidian|webnovel|wuxiaworld|69shu|uukanshu|biquge|zongheng|17k|jjwxc/i.test(s)) return "Chinese Novel";
    if (/syosetu|kakuyomu|alphapolis/i.test(s)) return "Japanese Novel";
    if (/munpia|naver|kakao|ridibooks|joara/i.test(s)) return "Korean Novel";
    return null;
  }
  const clean = s => String(s || "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}]/gu, " ")   // emojis / variation selectors
    .replace(/\*+|`+|~~+/g, "")                                                                      // markdown bold / code / strike
    .replace(/^[\s_#>•·\-–—|]+|[\s_|]+$/g, "")                                                     // bullets / pipes
    .replace(/\s{2,}/g, " ").trim();
  function parseDetails(text, d) {
    const lines = String(text || "").replace(/\r/g, "").split("\n").map(clean);
    const KEYS = { title: "title", name: "title", novel: "title", novelname: "title", noveltitle: "title", book: "title", bookname: "title", genre: "genres", genres: "genres", tags: "genres", tag: "genres", category: "genres", categories: "genres", status: "status", state: "status", summary: "summary", description: "summary", desc: "summary", synopsis: "summary", blurb: "summary", intro: "summary", introduction: "summary", about: "summary", plot: "summary", rating: "rating", rate: "rating", score: "rating", lang: "lang", language: "lang", source: "source", from: "source", origin: "source", author: "author", writer: "author", by: "author" };
    // keys we recognise but deliberately drop (also stops them leaking into the summary)
    const IGNORE = /^(uploaded ?by|uploader|upload|chapters?|chapter ?count|total ?chapters?|views?|id|link|url|website|site|translator|translation|original|year|released?|date|added|note|published|publisher|words?|size|file|format|type|rank|ranking|votes?|bookmarks?|likes?)$/;
    const HEADER = /^(new\s+)?(web ?novel|novel|book|light ?novel|upload)[\s\w]*!?$|^new web ?novel upload!?$/i;
    let key = null, found = false;
    for (const line of lines) {
      if (!line) { if (key !== "summary") key = null; continue; }
      const m = /^([A-Za-z][A-Za-z .'_-]{1,24}?)\s*[:：]\s*(.*)$/.exec(line);
      if (m) {
        const name = m[1].trim().toLowerCase().replace(/\s+/g, " ");
        const k = KEYS[name] || KEYS[name.replace(/\s+/g, "")];
        if (k) {
          key = k; found = true;
          let v = (m[2] || "").trim();
          if (k === "summary") d.summary = v; else d[k] = v;
          continue;
        }
        if (IGNORE.test(name)) { key = null; found = true; continue; }
      }
      if (key === "summary") d.summary = (d.summary ? d.summary + "\n" : "") + line;
      else if (key === "genres" && !m) d.genres += ", " + line;      // genre list wrapped to next line
      else if (!key && !found && !d.title && !HEADER.test(line)) { d.title = line; key = "freetitle"; }
      else if (key === "freetitle" && !m) { key = "summary"; d.summary = line; }
    }
    // normalise
    if (d.title) d.title = d.title.replace(/^["'“”«]+|["'“”»]+$/g, "").replace(/\s*[\[(](completed|ongoing|complete|mtl|raw|web ?novel)[\])]\s*$/i, "").trim().slice(0, 200);
    if (d.status) d.status = /complet|finish|end|done|full/i.test(d.status) ? "Completed" : "Ongoing";
    if (d.rating) { const r = parseFloat(String(d.rating).replace(/[^\d.]/g, " ")); d.rating = isFinite(r) ? Math.max(0, Math.min(5, r > 5 ? r / 2 : r)) : ""; }
    if (d.lang) { const l = d.lang.toLowerCase(); d.lang = /chin|cn|mtl/.test(l) ? "Chinese Novel" : /kor|kr/.test(l) ? "Korean Novel" : /jap|jp/.test(l) ? "Japanese Novel" : "English Novel"; }
    else { const g = guessLang(d, d.author); if (g) d.lang = g; }
    if (d.genres !== undefined) {
      const arr = normalizeGenres(d.genres);
      for (const g of inferGenres(d)) if (arr.length < 3 && !arr.includes(g)) arr.push(g);
      d.genresArr = arr.length ? arr : ["Fantasy"];
      if (!arr.length) d.genresGuessed = true;
    } else if (d.title || d.summary) {
      const arr = inferGenres(d);
      if (arr.length) { d.genresArr = arr.slice(0, 3); d.genresGuessed = true; }
    }
    if (d.summary) d.summary = d.summary.replace(/\n{3,}/g, "\n\n").trim().slice(0, 5000);
    delete d.author; delete d.source; // never stored – author is always the site author
    return d;
  }
  function summaryCard(d) {
    return `<b>📚 Draft</b>\n` +
      `• Title: ${d.title ? esc(d.title) : "<i>missing</i>"}\n` +
      `• Author: ${esc(AUTHOR)}\n` +
      `• Genres: ${d.genresArr && d.genresArr.length ? esc(d.genresArr.join(", ")) + (d.genresGuessed ? " <i>(auto)</i>" : "") : "<i>Fantasy (default)</i>"}\n` +
      `• Status: ${esc(d.status || "Ongoing")}\n` +
      `• Language: ${esc(d.lang || "English Novel")}\n` +
      (d.rating ? `• Rating: ${esc(d.rating)}\n` : "") +
      `• Cover: ${d.cover ? "✅" : "❌ send a photo"}\n` +
      `• Summary: ${d.summary ? esc(d.summary.slice(0, 120)) + (d.summary.length > 120 ? "…" : "") : "<i>none</i>"}\n` +
      (d.title ? `\n➡️ Now send the <b>.epub</b> (or .txt) file to publish.` : `\n➡️ Send the details (Title: … / Genres: … / Status: … / Summary: …).`);
  }

  /* ---------- plain-text chapter splitter (.txt files) ---------- */
  function parseTxt(text) {
    text = text.replace(/\r/g, "");
    const re = /^\s*(?:chapter|ch\.?|第)\s*(\d+)\s*(?:章|话|話)?\s*[:：\-–—.]?\s*(.*)$/gim;
    const marks = []; let m; while ((m = re.exec(text))) marks.push({ i: m.index, end: m.index + m[0].length, num: +m[1], title: m[0].trim() });
    if (marks.length < 2) return [{ num: null, title: "", body: text.trim() }];
    return marks.map((mk, k) => ({ num: mk.num, title: mk.title.slice(0, 300), body: text.slice(mk.end, k + 1 < marks.length ? marks[k + 1].i : undefined).trim() })).filter(c => c.body.length > 50);
  }

  /* ---------- publish ---------- */
  async function publish(chat, d, fileBuf, fileName) {
    const isEpub = /\.epub$/i.test(fileName);
    const progress = await tg("sendMessage", { chat_id: chat, text: `⏳ Reading ${fileName}…` }).catch(() => null);
    const edit = t => progress && tg("editMessageText", { chat_id: chat, message_id: progress.message_id, text: t, parse_mode: "HTML" }).catch(() => { });
    let chapters, meta = {};
    if (isEpub) ({ meta, chapters } = parseEpub(fileBuf)); else chapters = parseTxt(fileBuf.toString("utf8"));
    if (!chapters.length) throw new Error("No chapters found in the file.");
    const title = d.title || meta.title; if (!title) throw new Error("Title missing – send details first (Title: …).");

    // create or reuse novel
    let novel = d.slug ? await api.getNovel(d.slug) : await api.findByTitle(title);
    if (!novel) {
      novel = await api.createNovel({ title, author: AUTHOR, genres: d.genresArr || [], status: d.status || "Ongoing", summary: d.summary || "", cover: d.cover || "", rating: d.rating ? +d.rating : 0, lang: d.lang || "English Novel" });
      await edit(`✅ Novel created: <b>${esc(novel.title)}</b>\n⏳ Uploading ${chapters.length} chapters…`);
    } else {
      // update metadata that was provided
      const upd = { author: AUTHOR }; if (d.cover) upd.cover = d.cover; if (d.genresArr) upd.genres = d.genresArr; if (d.status) upd.status = d.status; if (d.summary) upd.summary = d.summary; if (d.lang) upd.lang = d.lang; if (d.rating) upd.rating = +d.rating;
      await api.updateNovel(novel.slug, upd);
      await edit(`ℹ️ Adding to existing novel: <b>${esc(novel.title)}</b>\n⏳ Uploading ${chapters.length} chapters…`);
    }
    const existing = await api.chapterIndex(novel.slug);
    let next = existing.length ? existing[existing.length - 1].num + 1 : 1;
    const useDetected = chapters.every(c => c.num !== null) && new Set(chapters.map(c => c.num)).size === chapters.length;
    chapters.forEach(c => { if (!useDetected || c.num === null) c.num = next++; else next = Math.max(next, c.num + 1); if (!c.title) c.title = `Chapter ${c.num}`; });
    let saved = 0;
    for (let i = 0; i < chapters.length; i += 25) {
      const r = await api.addChapters(novel.slug, chapters.slice(i, i + 25));
      saved += r.saved.length;
      if (chapters.length > 50 && (i / 25) % 4 === 3) await edit(`⏳ Uploaded ${saved}/${chapters.length} chapters…`);
    }
    const n = await api.getNovel(novel.slug);
    await edit(`🎉 <b>${esc(n.title)}</b> is live!\n• Author: ${esc(AUTHOR)}\n• Chapters uploaded: ${saved} (total ${n.chapters})\n• Range: ${chapters[0].num} → ${chapters[chapters.length - 1].num}\n\n🔗 ${siteUrl}/novel/${n.slug}`);
    reset(chat);
    drafts[chat] = { slug: n.slug, title: n.title, cover: n.cover, done: true }; // allow sending more files for same novel
  }

  /* ---------- update handler ---------- */
  async function onMessage(msg) {
    const chat = msg.chat.id, uid = msg.from && msg.from.id;
    const text = (msg.text || "").trim();
    if (!allowed(uid)) {
      if (/^\/start/.test(text) && !envIds.length && !store.owners.length) { store.owners.push(uid); save(); log(`[bot] first user ${uid} registered as owner`); }
      else { log(`[bot] ignored message from ${uid} (not allowed)`); return say(chat, `⛔ You are not allowed to use this bot.\nYour Telegram id: <code>${uid}</code>`); }
    }
    const d = draft(chat);

    if (/^\/(start|help)/.test(text)) {
      return say(chat, `👋 <b>Novelxplin uploader</b>\n\n1️⃣ Send the <b>cover photo</b> (caption may contain the details)\n2️⃣ Send the <b>details</b> – any share-card format works, e.g.\n<code>📖 Title: Shadow Slave\n🎭 Genre: Fantasy, Action\n📊 Status: Ongoing\n📄 Synopsis: In the gloom...</code>\n3️⃣ Send the <b>.epub</b> / .txt file\n\nAuthor is always <b>${esc(AUTHOR)}</b>; <i>Source</i>, <i>Uploaded by</i> and <i>Chapters</i> lines are ignored. Genres are matched to the site's genre list automatically.\n\n/status – show draft\n/new – start a new novel\n/cancel – discard draft\n/list – last 10 novels`);
    }
    if (/^\/(new|cancel)/.test(text)) { reset(chat); return say(chat, text.startsWith("/new") ? "🆕 New novel. Send the cover photo first." : "🗑 Draft discarded."); }
    if (/^\/status/.test(text)) return say(chat, summaryCard(d));
    if (/^\/list/.test(text)) { const all = await api.list(); return say(chat, all.length ? all.slice(0, 10).map(n => `• <b>${esc(n.title)}</b> – ${n.chapters} ch · ${esc(n.status)}`).join("\n") : "No novels yet."); }
    if (/^\/id/.test(text)) return say(chat, `Your id: <code>${uid}</code>`);

    // photo → cover
    if (msg.photo && msg.photo.length) {
      if (d.done) reset(chat);
      const ph = msg.photo[msg.photo.length - 1];
      try {
        const buf = await tgFile(ph.file_id, 5 * 1024 * 1024);
        const dd = draft(chat); dd.cover = await api.saveImage(buf, "image/jpeg");
        if (msg.caption) parseDetails(msg.caption, dd);
        return say(chat, `🖼 Cover saved.\n\n` + summaryCard(dd));
      } catch (e) { return say(chat, "❌ Could not save cover: " + esc(e.message)); }
    }
    // document → image cover or book file
    if (msg.document) {
      const doc = msg.document, name = doc.file_name || "file";
      if (/^image\//.test(doc.mime_type || "")) {
        try { if (d.done) reset(chat); const buf = await tgFile(doc.file_id, 5 * 1024 * 1024); const dd = draft(chat); dd.cover = await api.saveImage(buf, doc.mime_type); if (msg.caption) parseDetails(msg.caption, dd); return say(chat, "🖼 Cover saved.\n\n" + summaryCard(dd)); }
        catch (e) { return say(chat, "❌ Could not save cover: " + esc(e.message)); }
      }
      if (!/\.(epub|txt)$/i.test(name)) return say(chat, "❌ Only .epub or .txt files are supported.");
      if (doc.file_size > 20 * 1024 * 1024) return say(chat, "❌ Telegram bots can only download files up to 20 MB. Please split the book or use the web admin panel.");
      if (msg.caption) parseDetails(msg.caption, d);
      if (!d.title && !/\.epub$/i.test(name)) return say(chat, "❌ Send the details first (at least <code>Title: …</code>), then the file.");
      try { const buf = await tgFile(doc.file_id); await publish(chat, d, buf, name); }
      catch (e) { log("[bot] publish failed:", e); return say(chat, "❌ Upload failed: " + esc(e.message)); }
      return;
    }
    // plain text → details
    if (text) {
      if (d.done) reset(chat);
      parseDetails(text, draft(chat));
      return say(chat, summaryCard(draft(chat)));
    }
  }

  // messages of the same chat are handled strictly in order (photo → details → file)
  const queues = {};
  function enqueue(msg) {
    const id = msg.chat.id;
    queues[id] = (queues[id] || Promise.resolve()).then(() => onMessage(msg)).catch(e => log("[bot] handler error:", e));
  }

  /* ---------- long polling loop ---------- */
  let offset = 0, running = true;
  (async function loop() {
    try { const me = await tg("getMe"); log(`[bot] Telegram bot @${me.username} started (owners: ${[...envIds, ...store.owners].join(", ") || "first /start wins"})`); } catch (e) { log("[bot] getMe failed – check TELEGRAM_BOT_TOKEN:", e.message); }
    while (running) {
      try {
        const updates = await tg("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] });
        for (const u of updates) { offset = u.update_id + 1; if (u.message) enqueue(u.message); }
      } catch (e) { log("[bot] poll error:", e.message); await new Promise(r => setTimeout(r, 3000)); }
    }
  })();
  return { stop() { running = false; } };
}

module.exports = { startBot };
