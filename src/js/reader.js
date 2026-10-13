/* =========================================================
   Novelxplin – advanced reader (read.html)
   • progress bar + remaining reading time      • auto-scroll (speed control)
   • text-to-speech with paragraph highlight    • swipe / tap / keyboard navigation
   • focus (immersive) mode                      • scroll-position restore per chapter
   • next-chapter prefetch + infinite "continue" • extra themes, width, align, spacing
   ========================================================= */
document.addEventListener("app:ready", async () => {
  const { $, $$, esc, q, U, I } = UI;
  const n = DB.get(q.get("n"));
  let c = Math.max(1, parseInt(q.get("c") || "1", 10));
  if (!n) { SK.clear(); $("#content").innerHTML = `<div class="empty">${I.search}<div>Chapter not found.</div></div>`; return; }
  // Navigation is driven by the chapter INDEX (real chapter numbers), never by c ± 1 or by
  // n.chapters (which is a file count): EPUBs may start at 501, skip numbers or have gaps.
  let index = [];
  try { index = await DB.chapters(n.slug); } catch { }
  if (!index.length && n.chapters > 0) { // index API unreachable → best-effort 1..latest so Prev/Next still work
    const last = (n.latest && n.latest.num) || n.chapters;
    index = Array.from({ length: last }, (_, i) => ({ num: i + 1, title: DB.chapterTitle(n, i + 1) }));
  }
  const pos = () => index.findIndex(i => i.num === c);
  // neighbours by index position; when c itself is missing, fall back to the nearest existing numbers
  const prevNum = () => { const i = pos(); if (i >= 0) return i > 0 ? index[i - 1].num : null; const x = index.filter(x => x.num < c).pop(); return x ? x.num : null; };
  const nextNum = () => { const i = pos(); if (i >= 0) return i < index.length - 1 ? index[i + 1].num : null; const x = index.find(x => x.num > c); return x ? x.num : null; };
  if (index.length && pos() < 0) {
    SK.clear();
    const near = nextNum() ?? prevNum();
    $("#content").innerHTML = `<div class="empty">${I.search}<div>Chapter ${c} not found.</div>${near ? `<p style="margin-top:10px"><a class="btn" href="${U.chapter(n.slug, near)}">Go to Chapter ${near}</a></p>` : ""}<p style="margin-top:8px"><a href="${U.novel(n.slug)}">Back to chapter list</a></p></div>`;
    return;
  }
  Lib.mark(n.id, c);
  // count one view per chapter actually opened (server ignores GET-based prefetches)
  const countView = () => DB.api(`/api/novels/${encodeURIComponent(n.slug)}/view`, { method: "POST" }).catch(() => { });
  countView();

  /* ---------- top bar ---------- */
  $(".reader-top a[title=Home]").innerHTML = I.home;
  const libBtn = $("#rtLib");
  const setLib = () => libBtn.innerHTML = `${I.heart} <span class="lbl">${Lib.has(n.id) ? "In Library" : "Add to Library"}</span>`;
  setLib();
  libBtn.addEventListener("click", e => { e.preventDefault(); const a = Lib.toggle(n.id); setLib(); toast(a ? "Added to your library" : "Removed from library"); });

  const link = cc => U.chapter(n.slug, cc);
  const titleOf = cc => { const x = index.find(i => i.num === cc); return x && x.title ? x.title : `Chapter ${cc}`; };
  let title = titleOf(c);
  document.title = `${n.title} - ${title} | Novelxplin`;
  $("#rtTitle").innerHTML = `<a href="${U.novel(n.slug)}">${esc(n.title)}</a> <span style="color:var(--muted)">/ ${esc(title)}</span>`;

  function nav() {
    const sel = `<select onchange="location.href=this.value" aria-label="Jump to chapter">${index.map(ch => `<option value="${link(ch.num)}" ${ch.num === c ? "selected" : ""}>${esc(ch.title || "Chapter " + ch.num)}</option>`).join("")}</select>`;
    const pv = prevNum(), nx = nextNum();
    return `<a class="btn alt ${pv == null ? "disabled" : ""}" href="${pv == null ? U.novel(n.slug) : link(pv)}">${I.left} Prev</a>
      <a class="btn ghost" href="${U.novel(n.slug)}">${I.list} Index</a>
      ${sel}
      <a class="btn ${nx == null ? "disabled" : ""}" href="${nx == null ? U.novel(n.slug) : link(nx)}">Next ${I.right}</a>`;
  }
  $("#navTop").innerHTML = nav(); $("#navBottom").innerHTML = nav();

  /* ---------- chapter body ---------- */
  $("#content").innerHTML = SK.html("reader", 4);
  let paras = [];
  const content = $("#content");
  function renderChapter(ch) {
    const body = Array.isArray(ch.body) ? ch.body : String(ch.body || "").split(/\n{2,}|\n/).filter(Boolean);
    paras = body;
    const words = body.join(" ").split(/\s+/).filter(Boolean).length;
    const mins = Math.max(1, Math.round(words / 230));
    content.innerHTML = `<h1>${esc(ch.title || title)}</h1>
      <div class="sub">${esc(n.title)} &middot; ${esc((ch.date || "").slice(0, 10))} &middot; ${words.toLocaleString()} words &middot; ${I.clock} ${mins} min read</div>`
      + body.map((p, i) => `<p data-i="${i}">${esc(p)}</p>`).join("")
      + `<div class="chapter-end">
          <div class="ce-title">End of ${esc(ch.title || title)}</div>
          <div class="ce-actions">
            ${prevNum() != null ? `<a class="btn ghost" href="${link(prevNum())}">${I.left} Previous</a>` : ""}
            ${nextNum() != null ? `<a class="btn" href="${link(nextNum())}">Next chapter ${I.right}</a>` : `<a class="btn" href="${U.novel(n.slug)}">${I.check} You're all caught up</a>`}
          </div>
          <button class="btn ghost small" id="shareBtn">${I.horn} Share chapter</button>
        </div>`;
    $("#shareBtn")?.addEventListener("click", share);
  }
  try { renderChapter(await DB.chapter(n.slug, c)); }
  catch (e) { content.innerHTML = `<div class="empty">${I.search}<div>Failed to load chapter: ${esc(e.message)}</div></div>`; }
  // in-place chapter switch (used by TTS auto-continue so audio keeps playing in background)
  async function loadChapter(cc) {
    const ch = await DB.chapter(n.slug, cc);
    c = cc; title = titleOf(c); Lib.mark(n.id, c); countView();
    document.title = `${n.title} - ${title} | Novelxplin`;
    $("#rtTitle").innerHTML = `<a href="${U.novel(n.slug)}">${esc(n.title)}</a> <span style="color:var(--muted)">/ ${esc(title)}</span>`;
    $("#navTop").innerHTML = nav(); $("#navBottom").innerHTML = nav();
    renderChapter(ch);
    try { history.pushState({ c }, "", link(c)); } catch { }
    scrollTo(0, 0);
    bindComments(); // comments follow the chapter that is actually on screen
    if (nextNum() != null) DB.chapter(n.slug, nextNum()).catch(() => { });
  }
  addEventListener("popstate", () => location.reload());

  // share
  async function share() {
    const data = { title: document.title, text: `${n.title} – ${title}`, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); toast("Link copied"); } } catch { }
  }
  $("#shareBtn")?.addEventListener("click", share);

  // prefetch next chapter (API + HTML) so "Next" feels instant (does not count as a view)
  if (nextNum() != null) {
    DB.chapter(n.slug, nextNum()).catch(() => { });
    const pf = u => { const l = document.createElement("link"); l.rel = "prefetch"; l.href = u; document.head.appendChild(l); };
    pf(link(nextNum())); // API prefetch is done via DB.chapter() (needs the X-NX-Token header)
  }

  /* ---------- settings ---------- */
  const DEF = { theme: "paper", size: 18, font: "serif", lh: 1.8, width: 860, align: "left", pspace: 1.1, autoSpeed: 2, ttsRate: 1.2, ttsPitch: 0, ttsVoice: "", ttsEngine: "edge", edgeVoice: "en-US-EmmaMultilingualNeural", gLang: "hi" };
  const prefs = Object.assign({}, DEF, JSON.parse(localStorage.getItem("nx_reader") || "{}"));
  const FONTS = { serif: 'Georgia, "Times New Roman", serif', sans: '"Inter", "Roboto", "Segoe UI", Arial, sans-serif', merri: '"Merriweather", Georgia, serif', lora: '"Lora", Georgia, serif', dys: '"OpenDyslexic", "Comic Sans MS", sans-serif' };
  function apply() {
    document.body.className = `reader-page theme-${prefs.theme}` + (document.body.classList.contains("focus-mode") ? " focus-mode" : "") + (document.body.classList.contains("rs-open") ? " rs-open" : "");
    const r = document.documentElement.style;
    r.setProperty("--read-size", prefs.size + "px");
    r.setProperty("--read-lh", prefs.lh);
    r.setProperty("--read-font", FONTS[prefs.font] || FONTS.serif);
    r.setProperty("--read-width", prefs.width + "px");
    r.setProperty("--read-align", prefs.align);
    r.setProperty("--read-pspace", prefs.pspace + "em");
    $("#sizeLabel").textContent = prefs.size + "px";
    $("#widthLabel").textContent = prefs.width >= 1200 ? "Full" : prefs.width + "px";
    $$("[data-theme]").forEach(b => b.querySelector(".sw").classList.toggle("active", b.dataset.theme === prefs.theme));
    $$("[data-font]").forEach(b => b.classList.toggle("active", b.dataset.font === prefs.font));
    $$("[data-lh]").forEach(b => b.classList.toggle("active", +b.dataset.lh === +prefs.lh));
    $$("[data-align]").forEach(b => b.classList.toggle("active", b.dataset.align === prefs.align));
    $$("[data-pspace]").forEach(b => b.classList.toggle("active", +b.dataset.pspace === +prefs.pspace));
    localStorage.setItem("nx_reader", JSON.stringify(prefs));
    // theme-color for mobile browsers
    const tc = { paper: "#f6f3ec", light: "#f3f4f8", sepia: "#e9dcc4", dark: "#141414", night: "#0b1220", oled: "#000000", green: "#e3eedd" }[prefs.theme] || "#f6f3ec";
    let m = $('meta[name=theme-color]'); if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); } m.content = tc;
  }
  const panel = $("#settings"), gear = $("#rtSettings");
  gear.innerHTML = I.gear;
  const setOpen = o => { panel.hidden = !o; panel.classList.toggle("open", o); gear.classList.toggle("active", o); gear.setAttribute("aria-expanded", o); document.body.classList.toggle("rs-open", o); };
  gear.addEventListener("click", e => { e.stopPropagation(); setOpen(panel.hidden); });
  $("#rsClose").addEventListener("click", () => setOpen(false));
  document.addEventListener("click", e => { if (!panel.hidden && !panel.contains(e.target) && !gear.contains(e.target)) setOpen(false); });
  panel.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || b.id === "rsClose") return;
    if (b.dataset.theme) prefs.theme = b.dataset.theme;
    if (b.dataset.size) prefs.size = Math.max(14, Math.min(30, prefs.size + +b.dataset.size));
    if (b.dataset.font) prefs.font = b.dataset.font;
    if (b.dataset.lh) prefs.lh = +b.dataset.lh;
    if (b.dataset.width) prefs.width = Math.max(560, Math.min(1200, prefs.width + +b.dataset.width));
    if (b.dataset.align) prefs.align = b.dataset.align;
    if (b.dataset.pspace) prefs.pspace = +b.dataset.pspace;
    if (b.id === "rsReset") Object.assign(prefs, DEF);
    apply();
  });
  apply();

  /* ---------- progress bar + scroll restore ---------- */
  const bar = $("#readProgress"), pct = $("#rtPct");
  const key = `nx_pos_${n.id}_${c}`;
  let saveT = 0;
  function onScroll() {
    const h = document.documentElement, max = h.scrollHeight - innerHeight;
    const p = max > 0 ? Math.min(1, scrollY / max) : 1;
    bar.style.transform = `scaleX(${p})`;
    if (pct) pct.textContent = Math.round(p * 100) + "%";
    clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(key, String(scrollY)); } catch { } }, 250);
    // immersive: hide bars when scrolling down on mobile
    if (innerWidth < 720 && !document.body.classList.contains("rs-open")) {
      const dy = scrollY - lastY; lastY = scrollY;
      if (Math.abs(dy) > 6) document.body.classList.toggle("bars-hidden", dy > 0 && scrollY > 120);
    }
  }
  let lastY = scrollY;
  addEventListener("scroll", onScroll, { passive: true });
  const saved = +localStorage.getItem(key) || 0;
  if (saved > 200) requestAnimationFrame(() => { scrollTo(0, saved); toast("Resumed where you left off"); });
  onScroll();
  // tidy old positions (keep last 60)
  try { const ks = Object.keys(localStorage).filter(k => k.startsWith("nx_pos_")); if (ks.length > 60) ks.slice(0, ks.length - 60).forEach(k => localStorage.removeItem(k)); } catch { }

  /* ---------- toolbar: focus / auto-scroll / TTS ---------- */
  const tools = $("#rtTools");
  tools.innerHTML = `
    <button class="icon-btn" id="tFocus" title="Focus mode (F)" aria-label="Focus mode">${I.eye}</button>
    <button class="icon-btn" id="tAuto" title="Auto-scroll (S)" aria-label="Auto scroll"><svg class="icon" viewBox="0 0 24 24"><path d="M12 4l-6 6h4v4H6l6 6 6-6h-4v-4h4z"/></svg></button>
    <button class="icon-btn" id="tTts" title="Listen (L)" aria-label="Read aloud">${I.horn}</button>`;

  // focus mode
  const focusBtn = $("#tFocus");
  const setFocus = on => { document.body.classList.toggle("focus-mode", on); focusBtn.classList.toggle("active", on); if (on) toast("Focus mode – tap text or press F to exit"); };
  focusBtn.addEventListener("click", () => setFocus(!document.body.classList.contains("focus-mode")));

  // auto-scroll
  const autoBtn = $("#tAuto"), autoBar = $("#autoBar");
  let autoOn = false, raf = 0, acc = 0;
  function autoStep() { if (!autoOn) return; acc += prefs.autoSpeed * 0.35; if (acc >= 1) { scrollBy(0, Math.floor(acc)); acc -= Math.floor(acc); } if (scrollY + innerHeight >= document.documentElement.scrollHeight - 2) setAuto(false); else raf = requestAnimationFrame(autoStep); }
  function setAuto(on) {
    autoOn = on; autoBtn.classList.toggle("active", on); autoBar.hidden = !on; cancelAnimationFrame(raf);
    if (on) { raf = requestAnimationFrame(autoStep); $("#asVal").textContent = prefs.autoSpeed; }
  }
  autoBtn.addEventListener("click", () => setAuto(!autoOn));
  autoBar.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.as) { prefs.autoSpeed = Math.max(1, Math.min(10, prefs.autoSpeed + +b.dataset.as)); $("#asVal").textContent = prefs.autoSpeed; localStorage.setItem("nx_reader", JSON.stringify(prefs)); }
    if (b.id === "asStop") setAuto(false);
  });
  ["wheel", "touchstart"].forEach(ev => addEventListener(ev, () => { if (autoOn) { acc = 0; } }, { passive: true }));

  // ---------- Listen (text-to-speech) ----------
  //   edge   : Microsoft neural voices (Hindi + 14 Indian/English) relayed by the server (/api/tts)
  //   google : Google Translate voice (gTTS) – plays straight from Google, zero server load
  //   device : browser speechSynthesis (offline)
  // Edge/Google audio goes through one <audio> element → keeps playing with the screen off,
  // lock-screen controls via Media Session, auto next chapter, sleep timer.
  const ttsBtn = $("#tTts"), ttsBar = $("#ttsBar"), sheet = $("#ttsSheet");
  const synth = window.speechSynthesis;
  const TT = window.NXTTS;
  let ttsOn = false, ttsIdx = 0, utter = null, ttsSeq = 0, paused = false, follow = true;
  const pEls = () => $$("#content p[data-i]");
  // make text pleasant to hear: drop URLs / decorative separators, tame "!!!" and "......", expand a few shorthands
  const speakable = t => String(t || "")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/^[\s*\-_=~#•·.]{3,}$/g, "")
    .replace(/([!?])\1{1,}/g, "$1").replace(/\.{3,}/g, "…").replace(/[*_~`#>]+/g, " ")
    .replace(/\b(TL|T\/N|A\/N)\s*:/gi, "Note: ").replace(/\bvs\.?\b/gi, "versus").replace(/\bMC\b/g, "main character")
    .replace(/\s+/g, " ").trim();
  const textOf = i => speakable(pEls()[i]?.textContent);
  const wordsIn = t => t.split(/\s+/).filter(Boolean).length;
  // resume point per novel+chapter
  const POS_KEY = "nx_tts_pos";
  const posAll = () => { try { return JSON.parse(localStorage.getItem(POS_KEY) || "{}"); } catch { return {}; } };
  const savePos = i => { try { const a = posAll(); a[n.id] = { c, i, t: Date.now() }; const ks = Object.keys(a); if (ks.length > 40) delete a[ks.sort((x, y) => a[x].t - a[y].t)[0]]; localStorage.setItem(POS_KEY, JSON.stringify(a)); } catch { } };
  const savedPos = () => { const p = posAll()[n.id]; return p && p.c === c ? p.i : -1; };
  const visiblePara = () => { const mid = innerHeight * 0.4; let best = 0; for (const p of pEls()) { const r = p.getBoundingClientRect(); if (r.bottom >= mid) { best = +p.dataset.i; break; } best = +p.dataset.i; } return best; };
  const savePrefs = () => localStorage.setItem("nx_reader", JSON.stringify(prefs));
  if (!["edge", "google", "device"].includes(prefs.ttsEngine)) prefs.ttsEngine = "edge";
  if (!TT) prefs.ttsEngine = "device";
  if (TT && !TT.has(TT.EDGE_VOICES, prefs.edgeVoice)) prefs.edgeVoice = DEF.edgeVoice;
  if (TT && !TT.has(TT.GOOGLE_LANGS, prefs.gLang)) prefs.gLang = DEF.gLang;
  prefs.ttsRate = Math.max(.5, Math.min(2, +prefs.ttsRate || DEF.ttsRate));
  prefs.ttsPitch = Math.max(-50, Math.min(50, Math.round(+prefs.ttsPitch || 0)));
  savePrefs(); // persist the (possibly defaulted) voice/speed/pitch so every chapter & visit uses the same settings
  const ENGINE_NAME = { edge: "Neural", google: "Google", device: "Device" };
  const ENGINE_NOTE = {
    edge: "Natural neural voices – Hindi, English & 8 Indian languages. Works with the screen off.",
    google: "Google Translate voice. Light & fast, plays directly from Google.",
    device: "Voices installed on this phone/PC. Works offline, but may stop when the screen locks."
  };

  // single shared audio element (created on user gesture so mobile allows the autoplay chain)
  const audio = document.createElement("audio"); audio.preload = "auto"; audio.setAttribute("playsinline", ""); audio.setAttribute("referrerpolicy", "no-referrer"); try { audio.referrerPolicy = "no-referrer"; } catch { } document.body.appendChild(audio);
  const cache = new Map(); // key → Promise<{urls, rate}> (rate = speed baked into the audio)
  let queue = [], qi = 0, blobUrls = [], aborters = [];
  const relBlobs = () => { blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch { } }); blobUrls = []; };
  const abortAll = () => { aborters.forEach(a => { try { a.abort(); } catch { } }); aborters = []; };
  const SILENCE = (() => { const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, s) => [...s].forEach((ch, i) => b[o + i] = ch.charCodeAt(0)); w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true); b.fill(128, 44); return URL.createObjectURL(new Blob([b], { type: "audio/wav" })); })();
  let unlocked = false;
  const unlock = () => { if (unlocked) return; audio.src = SILENCE; audio.play().then(() => { unlocked = true; }).catch(() => { }); };

  /* ----- device voices ----- */
  const devVoices = () => (synth ? synth.getVoices() : []).filter(v => /^(hi|en|mr|bn|ta|te|gu|kn|ml|pa|ur|ne)/i.test(v.lang)).sort((a, b) => (/^hi/i.test(b.lang) - /^hi/i.test(a.lang)) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  function pickVoice() {
    const vs = synth ? synth.getVoices() : [];
    return vs.find(v => v.name === prefs.ttsVoice) || vs.find(v => /^hi/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang) && /Google|Natural|Premium/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || vs[0];
  }
  const voiceArg = () => prefs.ttsEngine === "edge" ? prefs.edgeVoice : prefs.gLang;
  const relay = () => prefs.ttsEngine === "edge" || (prefs.ttsEngine === "google" && /^edge:/.test(prefs.gLang)); // audio generated by the neural relay (rate/pitch baked in)
  const pitchLabel = () => (prefs.ttsPitch > 0 ? "+" : "") + prefs.ttsPitch + "%";
  function voiceLabel() {
    if (prefs.ttsEngine === "edge") return TT.label(TT.EDGE_VOICES, prefs.edgeVoice);
    if (prefs.ttsEngine === "google") return TT.label(TT.GOOGLE_LANGS, prefs.gLang);
    const v = pickVoice(); return v ? v.name.replace(/^Microsoft |^Google /, "").split(" (")[0] : "Device";
  }
  function paintPlayer() {
    $("#ttsVoiceName").textContent = `${ENGINE_NAME[prefs.ttsEngine]} · ${voiceLabel()}`;
    const ch = $("#ttsChap"); if (ch) ch.textContent = title;
    const fb = $("#ttsFollow"); if (fb) fb.hidden = follow;
    $("#ttsRateVal").textContent = prefs.ttsRate + "x"; $("#tsRateVal").textContent = prefs.ttsRate + "x"; $("#tsRate").value = prefs.ttsRate;
    const pr = $("#tsPitchRow"); if (pr) { pr.hidden = !relay() && prefs.ttsEngine !== "device"; $("#tsPitchVal").textContent = pitchLabel(); $("#tsPitch").value = prefs.ttsPitch; }
    ttsBar.classList.toggle("paused", paused);
    $("#ttsPause").setAttribute("aria-label", paused ? "Play" : "Pause");
  }

  /* ----- voice sheet ----- */
  function renderSheet() {
    $$("#tsTabs button").forEach(b => { b.classList.toggle("active", b.dataset.eng === prefs.ttsEngine); if (!TT && b.dataset.eng !== "device") b.disabled = true; });
    $("#tsNote").textContent = ENGINE_NOTE[prefs.ttsEngine];
    const list = $("#tsList"); let html = "";
    const qs = ($("#tsFind")?.value || "").trim().toLowerCase();
    const match = (...s) => !qs || s.join(" ").toLowerCase().includes(qs);
    const canPreview = prefs.ttsEngine !== "device";
    const item = (id, name, g, sel) => `<button class="ts-voice ${sel ? "active" : ""}" data-v="${esc(id)}"><span class="ts-av ${g === "♂" ? "m" : g === "♀" ? "f" : "n"}">${g || "🔊"}</span><span>${esc(name)}</span>${sel ? '<svg class="icon" viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>' : ""}${canPreview ? `<span class="ts-prev" data-prev="${esc(id)}" title="Preview" role="button"><svg class="icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>` : ""}</button>`;
    const grpHtml = (groups, cur) => groups.map(grp => { const vs = grp.voices.filter(v => match(grp.group, v[1], v[0])); return vs.length ? `<div class="ts-grp">${esc(grp.group)}</div>` + vs.map(v => item(v[0], v[1], v[2], v[0] === cur)).join("") : ""; }).join("");
    if (prefs.ttsEngine === "edge") html = grpHtml(TT.EDGE_VOICES, prefs.edgeVoice);
    else if (prefs.ttsEngine === "google") html = grpHtml(TT.GOOGLE_LANGS, prefs.gLang);
    else { const vs = devVoices().filter(v => match(v.name, v.lang)); const cur = pickVoice(); html = vs.length ? vs.map(v => item(v.name, `${v.name.replace(/^Microsoft |^Google /, "")} · ${v.lang}`, "", cur && v.name === cur.name)).join("") : `<p class="ts-empty">${qs ? "No voice matches your search." : "No voices found on this device. Try Neural or Google."}</p>`; }
    if (!html) html = `<p class="ts-empty">No voice matches “${esc(qs)}”.</p>`;
    list.innerHTML = html;
    $$("#tsSleep button").forEach(b => b.classList.toggle("active", String(sleepMode) === b.dataset.sleep));
    paintPlayer();
  }
  const openSheet = o => { sheet.hidden = !o; document.body.classList.toggle("ts-open", o); if (o) renderSheet(); else { try { prevAudio.pause(); } catch { } } };
  $("#ttsVoiceBtn").addEventListener("click", () => openSheet(true));
  $("#ttsRateBtn").addEventListener("click", () => { prefs.ttsRate = prefs.ttsRate >= 2 ? 0.8 : +(prefs.ttsRate + 0.2).toFixed(1); applyRate(); });
  $("#tsClose").addEventListener("click", () => openSheet(false));
  sheet.addEventListener("click", e => { if (e.target === sheet) openSheet(false); });
  $("#tsTabs").addEventListener("click", e => { const b = e.target.closest("button[data-eng]"); if (!b || b.disabled) return; prefs.ttsEngine = b.dataset.eng; savePrefs(); cache.clear(); abortAll(); renderSheet(); if (ttsOn) setTts(true, ttsIdx); });
  $("#tsFind")?.addEventListener("input", renderSheet);
  // voice preview: a short sample in the voice's own language, without disturbing the main playback
  const prevAudio = document.createElement("audio"); prevAudio.setAttribute("referrerpolicy", "no-referrer"); try { prevAudio.referrerPolicy = "no-referrer"; } catch { }
  const SAMPLE = { hi: "नमस्ते! मैं आपको यह कहानी सुनाऊँगी। क्या आप तैयार हैं?", mr: "नमस्कार! मी तुम्हाला ही गोष्ट वाचून दाखवीन.", bn: "নমস্কার! আমি আপনাকে এই গল্পটি পড়ে শোনাব।", ta: "வணக்கம்! நான் இந்தக் கதையை உங்களுக்கு வாசிக்கிறேன்.", te: "నమస్కారం! నేను మీకు ఈ కథను వినిపిస్తాను.", gu: "નમસ્તે! હું તમને આ વાર્તા વાંચી સંભળાવીશ.", kn: "ನಮಸ್ಕಾರ! ನಾನು ನಿಮಗೆ ಈ ಕಥೆಯನ್ನು ഓದಿ ಹೇಳುತ್ತೇನೆ.", ml: "നമസ്കാരം! ഞാൻ ഈ കഥ നിങ്ങൾക്കായി വായിക്കാം.", ur: "آداب! میں آپ کو یہ کہانی سناتی ہوں۔", pa: "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਮੈਂ ਤੁਹਾਨੂੰ ਇਹ ਕਹਾਣੀ ਸੁਣਾਵਾਂਗਾ।", ne: "नमस्ते! म तपाईंलाई यो कथा सुनाउँछु।", en: "Hello! I'll be reading this story for you. Shall we begin?" };
  let prevSeq = 0;
  async function previewVoice(id, el) {
    const seq = ++prevSeq; prevAudio.pause();
    $$(".ts-prev.playing").forEach(x => x.classList.remove("playing")); el.classList.add("playing");
    const edgeId = id.replace(/^edge:/, ""); const lang = (prefs.ttsEngine === "edge" || /^edge:/.test(id)) ? edgeId.slice(0, 2) : id.slice(0, 2);
    const text = SAMPLE[lang] || SAMPLE.en;
    try {
      const urls = (prefs.ttsEngine === "edge" || /^edge:/.test(id)) ? [await TT.edge(text, edgeId, prefs.ttsRate, null, prefs.ttsPitch)] : TT.google(text, id);
      if (seq !== prevSeq) return;
      if (ttsOn && !paused) togglePause(true);
      prevAudio.src = urls[0]; prevAudio.onended = () => el.classList.remove("playing"); await prevAudio.play();
    } catch { el.classList.remove("playing"); toast("Preview unavailable"); }
  }
  $("#tsList").addEventListener("click", e => {
    const pv = e.target.closest(".ts-prev"); if (pv) { e.stopPropagation(); previewVoice(pv.dataset.prev, pv); return; }
    const b = e.target.closest("button[data-v]"); if (!b) return;
    if (prefs.ttsEngine === "edge") prefs.edgeVoice = b.dataset.v; else if (prefs.ttsEngine === "google") prefs.gLang = b.dataset.v; else prefs.ttsVoice = b.dataset.v;
    savePrefs(); cache.clear(); abortAll(); renderSheet(); if (ttsOn) setTts(true, ttsIdx); else toast("Voice: " + voiceLabel());
  });
  $("#tsRate").addEventListener("input", e => { prefs.ttsRate = +(+e.target.value).toFixed(1); paintPlayer(); });
  $("#tsRate").addEventListener("change", () => applyRate());
  $("#tsPitch").addEventListener("input", e => { prefs.ttsPitch = Math.round(+e.target.value); paintPlayer(); });
  $("#tsPitch").addEventListener("change", () => { prefs.ttsPitch = Math.max(-50, Math.min(50, Math.round(+prefs.ttsPitch || 0))); savePrefs(); paintPlayer(); if (ttsOn) { cache.clear(); abortAll(); setTts(true, ttsIdx); } });
  function applyRate() {
    prefs.ttsRate = Math.max(.5, Math.min(2, +prefs.ttsRate.toFixed(1))); savePrefs(); paintPlayer();
    if (!ttsOn) return;
    if (prefs.ttsEngine === "device") { setTts(true, ttsIdx); return; }
    // no interruption: stretch the current clip, next paragraphs are synthesized at the new native speed
    syncRate(); toast(`Speed ${prefs.ttsRate}x`);
  }
  function syncRate() { try { audio.preservesPitch = true; audio.mozPreservesPitch = true; } catch { } audio.playbackRate = Math.max(.5, Math.min(4, prefs.ttsRate / (curRate || 1))); }
  if (synth) synth.onvoiceschanged = () => { if (prefs.ttsEngine === "device" && !sheet.hidden) renderSheet(); };

  /* ----- sleep timer ----- */
  let sleepMode = 0, sleepT = 0;
  $("#tsSleep").addEventListener("click", e => {
    const b = e.target.closest("button[data-sleep]"); if (!b) return;
    clearTimeout(sleepT); sleepMode = b.dataset.sleep === "chapter" ? "chapter" : +b.dataset.sleep;
    if (typeof sleepMode === "number" && sleepMode > 0) sleepT = setTimeout(() => { setTts(false); toast("Sleep timer – stopped listening"); }, sleepMode * 60000);
    $$("#tsSleep button").forEach(x => x.classList.toggle("active", x === b));
    toast(sleepMode === 0 ? "Sleep timer off" : sleepMode === "chapter" ? "Will stop at the end of this chapter" : `Will stop in ${sleepMode} min`);
  });

  /* ----- synthesis + playback ----- */
  const cacheKey = (i, text) => `${prefs.ttsEngine}|${voiceArg()}|${relay() ? prefs.ttsPitch : 0}|${c}|${i}|${text.length}`;
  async function getAudio(i, text) {
    text = text ?? textOf(i);
    const k = cacheKey(i, text); if (cache.has(k)) return cache.get(k);
    const ac = typeof AbortController !== "undefined" ? new AbortController() : null; if (ac) aborters.push(ac);
    const rate = relay() ? prefs.ttsRate : 1;
    const p = TT.synthesize(prefs.ttsEngine, text, voiceArg(), rate, ac && ac.signal, prefs.ttsPitch).then(urls => { if (relay()) blobUrls.push(...urls); return { urls, rate }; });
    cache.set(k, p); p.catch(() => cache.delete(k)).finally(() => { aborters = aborters.filter(a => a !== ac); });
    if (cache.size > 14) cache.delete(cache.keys().next().value);
    return p;
  }
  // warm the server cache for the first lines of the next chapter so auto-continue is seamless
  let nextWarm = 0;
  function warmNext() {
    if (nextWarm === c || nextNum() == null || !relay()) return; nextWarm = c;
    DB.chapter(n.slug, nextNum()).then(ch => { const body = Array.isArray(ch.body) ? ch.body : String(ch.body || "").split(/\n{2,}|\n/).filter(Boolean); body.slice(0, 2).map(speakable).filter(Boolean).forEach(t => TT.edge(t, voiceArg().replace(/^edge:/, ""), prefs.ttsRate, null, prefs.ttsPitch).then(u => { try { URL.revokeObjectURL(u); } catch { } }).catch(() => { })); }).catch(() => { });
  }
  const WPM = 165; // neural voices at 1x
  function remaining(i) {
    const els = pEls(); let w = 0; for (let k = i; k < els.length; k++) w += wordsIn(els[k].textContent);
    const m = Math.round(w / (WPM * prefs.ttsRate)); return m < 1 ? "<1 min" : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
  }
  function highlight(i) {
    const els = pEls(); els.forEach(p => p.classList.remove("speaking"));
    if (els[i]) { els[i].classList.add("speaking"); if (follow && document.visibilityState === "visible") { autoScrolling = true; els[i].scrollIntoView({ block: "center", behavior: "smooth" }); clearTimeout(asT); asT = setTimeout(() => autoScrolling = false, 900); } }
    setStatus(`${i + 1}/${els.length} · ${remaining(i)} left`); $("#ttsTrack").style.width = (els.length ? ((i + 1) / els.length) * 100 : 0) + "%";
    savePos(i);
  }
  // user scrolls away while listening → stop auto-centering, show "Now playing ↓" to jump back
  let autoScrolling = false, asT = 0;
  const userScrolled = () => { if (!ttsOn || autoScrolling || !follow) return; follow = false; paintPlayer(); };
  addEventListener("wheel", userScrolled, { passive: true }); addEventListener("touchmove", userScrolled, { passive: true });
  const refollow = () => { follow = true; paintPlayer(); const p = pEls()[ttsIdx]; if (p) { autoScrolling = true; p.scrollIntoView({ block: "center", behavior: "smooth" }); clearTimeout(asT); asT = setTimeout(() => autoScrolling = false, 900); } };
  $("#ttsFollow")?.addEventListener("click", refollow);
  // tap on the progress track → jump to that paragraph
  const trackEl = $(".tp-track");
  const seekTo = e => { const r = trackEl.getBoundingClientRect(); const x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; const els = pEls(); const i = Math.max(0, Math.min(els.length - 1, Math.floor(x / r.width * els.length))); follow = true; setTts(true, i); };
  trackEl?.addEventListener("click", seekTo);
  const setStatus = t => { const s = $("#ttsStatus"); if (s) s.textContent = t; };
  function setMedia(state) {
    if (!("mediaSession" in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title, artist: n.title, album: "Novelxplin", artwork: n.cover ? [{ src: n.cover, sizes: "512x512", type: "image/jpeg" }] : [] });
      navigator.mediaSession.playbackState = state;
      navigator.mediaSession.setActionHandler("play", () => togglePause(false));
      navigator.mediaSession.setActionHandler("pause", () => togglePause(true));
      navigator.mediaSession.setActionHandler("stop", () => setTts(false));
      navigator.mediaSession.setActionHandler("previoustrack", () => setTts(true, Math.max(0, ttsIdx - 1)));
      navigator.mediaSession.setActionHandler("nexttrack", () => setTts(true, ttsIdx + 1));
      navigator.mediaSession.setActionHandler("seekbackward", () => setTts(true, Math.max(0, ttsIdx - 1)));
      navigator.mediaSession.setActionHandler("seekforward", () => setTts(true, ttsIdx + 1));
    } catch { }
  }
  let curRate = 1; // speed baked into the clip currently playing
  function playQueue(seq) {
    if (seq !== ttsSeq || qi >= queue.length) return;
    audio.src = queue[qi]; syncRate();
    audio.play().catch(() => { if (seq === ttsSeq) { toast("Tap ▶ to start listening"); togglePause(true); } });
  }
  audio.addEventListener("ended", () => { if (audio.src === SILENCE) return; qi++; if (qi < queue.length) playQueue(ttsSeq); else if (ttsOn) speak(ttsIdx + 1); });
  audio.addEventListener("error", () => { if (!ttsOn || !audio.src || audio.src === SILENCE) return; qi++; if (qi < queue.length) playQueue(ttsSeq); else if (prefs.ttsEngine === "google" && synth) { toast("Google voice failed – using device voice"); prefs.ttsEngine = "device"; savePrefs(); speak(ttsIdx); } else speak(ttsIdx + 1); });

  async function nextChapter() {
    if (sleepMode === "chapter") { setTts(false); toast("Chapter finished – sleep timer stopped listening"); return; }
    const nx = nextNum();
    if (nx == null) { setTts(false); toast("You're all caught up"); return; }
    setStatus("next…");
    const seq = ttsSeq;
    try {
      cache.clear(); relBlobs();
      await loadChapter(nx);
      if (!ttsOn || seq !== ttsSeq) return;
      toast(`Now playing: ${title}`);
      speak(0);
    } catch (e) { toast("Could not load next chapter"); setTts(false); }
  }
  let edgeFails = 0;
  async function speak(i) {
    const els = pEls(); if (i >= els.length) { nextChapter(); return; }
    ttsIdx = i; highlight(i); paused = false; paintPlayer();
    const seq = ++ttsSeq;
    if (prefs.ttsEngine === "device") {
      if (!synth) { toast("Device voice not supported here – switch to Neural/Google"); openSheet(true); return; }
      synth.cancel();
      const dt = textOf(i); if (!dt) { speak(i + 1); return; }
      utter = new SpeechSynthesisUtterance(dt);
      utter.rate = prefs.ttsRate; utter.pitch = Math.max(0, Math.min(2, 1 + prefs.ttsPitch / 50)); const v = pickVoice(); if (v) { utter.voice = v; utter.lang = v.lang; }
      utter.onend = () => { if (ttsOn && seq === ttsSeq) speak(i + 1); };
      utter.onerror = e => { if (e.error !== "interrupted" && e.error !== "canceled") setTts(false); };
      synth.speak(utter); setMedia("playing"); return;
    }
    ttsBar.classList.add("loading");
    const text = textOf(i);
    if (!text) { speak(i + 1); return; } // decorative separator / empty line
    try {
      const got = await getAudio(i, text); qi = 0;
      if (seq !== ttsSeq || !ttsOn) return;
      queue = got.urls; curRate = got.rate;
      ttsBar.classList.remove("loading"); edgeFails = 0;
      playQueue(seq); setMedia("playing");
      for (let k = 1; k <= 3; k++) if (i + k < els.length) getAudio(i + k).catch(() => { }); // prefetch so playback never stalls
      if (i + 4 >= els.length) warmNext();
    } catch (e) {
      if (seq !== ttsSeq) return;
      ttsBar.classList.remove("loading");
      if (e.name === "AbortError") return;
      console.warn("TTS", e);
      if (prefs.ttsEngine === "edge" && ++edgeFails < 3) { toast("Voice server hiccup – retrying…"); setTimeout(() => { if (ttsOn && seq === ttsSeq) speak(i); }, 1200 * edgeFails); return; }
      if (prefs.ttsEngine === "edge") { toast("Neural voice unavailable right now – switched to Google"); prefs.ttsEngine = "google"; prefs.gLang = /^hi/.test(prefs.edgeVoice) ? "hi" : "en-IN"; savePrefs(); paintPlayer(); edgeFails = 0; speak(i); }
      else if (synth) { toast("Online voice failed – using device voice"); prefs.ttsEngine = "device"; savePrefs(); paintPlayer(); speak(i); }
      else { toast("Text-to-speech failed: " + e.message); setTts(false); }
    }
  }
  function togglePause(p) {
    if (!ttsOn) return;
    paused = p; paintPlayer();
    if (prefs.ttsEngine === "device") { p ? synth.pause() : synth.resume(); }
    else { p ? audio.pause() : audio.play().catch(() => { }); }
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = p ? "paused" : "playing";
  }
  function setTts(on, from) {
    const wasOn = ttsOn; ttsOn = on; ttsBtn.classList.toggle("active", on); ttsBar.hidden = !on; document.body.classList.toggle("tts-on", on);
    ttsSeq++; if (synth) synth.cancel(); abortAll();
    audio.pause();
    if (on && prefs.ttsEngine !== "device") unlock(); else { audio.removeAttribute("src"); audio.load(); }
    if (on && from == null && !wasOn) { // fresh start → resume where you left off, else from what's on screen
      const sp = savedPos(), vp = visiblePara();
      if (sp > 0 && sp < pEls().length - 1) { ttsIdx = sp; toast(`Resuming from paragraph ${sp + 1}`); }
      else ttsIdx = vp;
      follow = true;
    }
    if (on) { paintPlayer(); speak(from ?? ttsIdx); }
    else { openSheet(false); clearTimeout(sleepT); sleepMode = 0; pEls().forEach(p => p.classList.remove("speaking")); relBlobs(); cache.clear(); ttsBar.classList.remove("loading"); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none"; }
  }
  ttsBtn.addEventListener("click", () => setTts(!ttsOn));
  ttsBar.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "ttsPrev") { follow = true; setTts(true, Math.max(0, ttsIdx - 1)); }
    if (b.id === "ttsNext") { follow = true; setTts(true, ttsIdx + 1); }
    if (b.id === "ttsStop") setTts(false);
    if (b.id === "ttsPause") togglePause(!paused);
  });
  // click a paragraph while TTS is on → start reading from there
  content.addEventListener("click", e => {
    const p = e.target.closest("p[data-i]");
    if (ttsOn && p) { follow = true; setTts(true, +p.dataset.i); return; }
    if (document.body.classList.contains("focus-mode") && !e.target.closest("a,button")) setFocus(false);
  });
  // double-tap a paragraph → start listening from there
  content.addEventListener("dblclick", e => { const p = e.target.closest("p[data-i]"); if (p && !ttsOn) { getSelection()?.removeAllRanges(); follow = true; setTts(true, +p.dataset.i); } });
  paintPlayer();
  addEventListener("beforeunload", () => { synth && synth.cancel(); relBlobs(); });

  /* ---------- keyboard + swipe navigation ---------- */
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { if (!sheet.hidden) openSheet(false); else if (!panel.hidden) setOpen(false); else if (document.body.classList.contains("focus-mode")) setFocus(false); }
    if (e.key === " " && ttsOn) { e.preventDefault(); togglePause(!paused); }
    if (ttsOn && (e.key === "[" || e.key === "]")) { follow = true; setTts(true, e.key === "[" ? Math.max(0, ttsIdx - 1) : ttsIdx + 1); return; }
    if (ttsOn && (e.key === "," || e.key === ".")) { prefs.ttsRate = +(prefs.ttsRate + (e.key === "." ? .1 : -.1)).toFixed(1); applyRate(); return; }
    if (e.key === "ArrowLeft" && prevNum() != null) location.href = link(prevNum());
    if (e.key === "ArrowRight" && nextNum() != null) location.href = link(nextNum());
    const k = e.key.toLowerCase();
    if (k === "f") setFocus(!document.body.classList.contains("focus-mode"));
    if (k === "s") setAuto(!autoOn);
    if (k === "l") setTts(!ttsOn);
    if (k === "+" || k === "=") { prefs.size = Math.min(30, prefs.size + 1); apply(); }
    if (k === "-") { prefs.size = Math.max(14, prefs.size - 1); apply(); }
    if (k === "t") { const th = ["paper", "light", "sepia", "green", "dark", "night", "oled"]; prefs.theme = th[(th.indexOf(prefs.theme) + 1) % th.length]; apply(); toast("Theme: " + prefs.theme); }
    if (k === "?") $("#kbHelp")?.classList.toggle("show");
  });
  let tx = 0, ty = 0, tt = 0;
  addEventListener("touchstart", e => { const t = e.touches[0]; tx = t.clientX; ty = t.clientY; tt = Date.now(); }, { passive: true });
  addEventListener("touchend", e => {
    const t = e.changedTouches[0], dx = t.clientX - tx, dy = t.clientY - ty;
    if (Date.now() - tt > 600 || Math.abs(dx) < 80 || Math.abs(dy) > 60 || tx < 24) return; // ignore slow / vertical / edge-back gestures
    if (dx < 0 && nextNum() != null) { toast("Next chapter →"); location.href = link(nextNum()); }
    else if (dx > 0 && prevNum() != null) { toast("← Previous chapter"); location.href = link(prevNum()); }
  }, { passive: true });

  /* ---------- comments – Firestore when available, else local ----------
     Bound to the chapter currently shown; re-bound by loadChapter() when TTS auto-continues. */
  const colors = ["#e67e22", "#1e73be", "#2e9e4f", "#7e57c2", "#e53935"];
  let ckey = "", col = null, cSeq = 0;
  const show = (list, seq) => { if (seq !== cSeq) return; $("#comments").innerHTML = list.length ? list.map((cm, i) => `<div class="comment"><div class="avatar" style="background:${colors[i % colors.length]}">${esc((cm.who || "?")[0])}</div><div><div class="who">${esc(cm.who)}<small>${DB.timeAgo(Math.round((Date.now() - cm.at) / 6e4))}</small></div><p>${esc(cm.text)}</p></div></div>`).join("") : `<p style="color:var(--muted);font-size:12px;margin-top:10px">No comments yet. Be the first!</p>`; };
  async function renderComments() {
    const seq = cSeq, k = ckey, cl = col;
    if (cl) { try { const s = await Promise.race([cl.orderBy("at", "desc").limit(50).get(), new Promise((_, rej) => setTimeout(() => rej(new Error("comments timeout")), 8000))]); return show(s.docs.map(d => d.data()), seq); } catch (e) { console.warn(e); } }
    show(JSON.parse(localStorage.getItem(k) || "[]"), seq);
  }
  function bindComments() {
    cSeq++; ckey = `nx_comments_${n.id}_${c}`;
    col = window.firebase && Auth.enabled ? firebase.firestore().collection("comments").doc(n.slug).collection(String(c)) : null;
    const ta = $("#cText"); if (ta) ta.value = "";
    renderComments();
  }
  $("#cPost").addEventListener("click", async () => {
    const u = Auth.user(); if (!u) { openLogin(); return; }
    const t = $("#cText").value.trim(); if (!t) return;
    const cm = { who: u.name, uid: u.uid || "", text: t.slice(0, 2000), at: Date.now() };
    if (col) { try { await col.add(cm); } catch (e) { toast("Failed: " + e.message); return; } }
    else { const list = JSON.parse(localStorage.getItem(ckey) || "[]"); list.unshift(cm); localStorage.setItem(ckey, JSON.stringify(list)); }
    $("#cText").value = ""; renderComments(); toast("Comment posted");
  });
  bindComments();
});
