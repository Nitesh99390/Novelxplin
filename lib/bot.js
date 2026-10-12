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

  function parseDetails(text, d) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const KEYS = { title: "title", name: "title", novel: "title", genre: "genres", genres: "genres", tags: "genres", status: "status", summary: "summary", description: "summary", desc: "summary", synopsis: "summary", rating: "rating", lang: "lang", language: "lang" };
    let key = null, found = false;
    for (const raw of lines) {
      const m = /^\s*([A-Za-z ]{3,12})\s*[:：\-]\s*(.*)$/.exec(raw);
      const k = m && KEYS[m[1].trim().toLowerCase()];
      if (k) { key = k; found = true; d[k] = (m[2] || "").trim(); continue; }
      if (key === "summary") d.summary = (d.summary ? d.summary + "\n" : "") + raw.trim();
      else if (key && raw.trim()) d[key] += " " + raw.trim();
    }
    if (!found) { // free text: first line = title, rest = summary
      const t = lines.filter(l => l.trim());
      if (t.length) { d.title = t[0].trim(); if (t.length > 1) d.summary = t.slice(1).join("\n"); }
    }
    if (d.status) d.status = /complete|finished|end/i.test(d.status) ? "Completed" : "Ongoing";
    if (d.genres) d.genresArr = String(d.genres).split(/[,，/|]/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    return d;
  }
  function summaryCard(d) {
    return `<b>📚 Draft</b>\n` +
      `• Title: ${d.title ? esc(d.title) : "<i>missing</i>"}\n` +
      `• Author: ${esc(AUTHOR)}\n` +
      `• Genres: ${d.genresArr && d.genresArr.length ? esc(d.genresArr.join(", ")) : "<i>Fantasy (default)</i>"}\n` +
      `• Status: ${esc(d.status || "Ongoing")}\n` +
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
      const upd = { author: AUTHOR }; if (d.cover) upd.cover = d.cover; if (d.genresArr) upd.genres = d.genresArr; if (d.status) upd.status = d.status; if (d.summary) upd.summary = d.summary;
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
    await edit(`🎉 <b>${esc(n.title)}</b> is live!\n• Author: ${esc(AUTHOR)}\n• Chapters uploaded: ${saved} (total ${n.chapters})\n• Range: ${chapters[0].num} → ${chapters[chapters.length - 1].num}\n\n🔗 ${siteUrl}/novel.html?n=${n.slug}`);
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
      return say(chat, `👋 <b>Novelxplin uploader</b>\n\n1️⃣ Send the <b>cover photo</b>\n2️⃣ Send the <b>details</b>:\n<code>Title: Shadow Slave\nGenres: Fantasy, Action\nStatus: Ongoing\nSummary: In the gloom...</code>\n3️⃣ Send the <b>.epub</b> / .txt file\n\nAuthor is always <b>${esc(AUTHOR)}</b>.\n\n/status – show draft\n/new – start a new novel\n/cancel – discard draft\n/list – last 10 novels`);
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
