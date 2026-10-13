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
  if (!n || c > n.chapters) { SK.clear(); $("#content").innerHTML = `<div class="empty">${I.search}<div>Chapter not found.</div></div>`; return; }
  Lib.mark(n.id, c);

  /* ---------- top bar ---------- */
  $(".reader-top a[title=Home]").innerHTML = I.home;
  const libBtn = $("#rtLib");
  const setLib = () => libBtn.innerHTML = `${I.heart} <span class="lbl">${Lib.has(n.id) ? "In Library" : "Add to Library"}</span>`;
  setLib();
  libBtn.addEventListener("click", e => { e.preventDefault(); const a = Lib.toggle(n.id); setLib(); toast(a ? "Added to your library" : "Removed from library"); });

  const link = cc => U.chapter(n.slug, cc);
  let index = [];
  try { index = await DB.chapters(n.slug); } catch { }
  const titleOf = cc => { const x = index.find(i => i.num === cc); return x && x.title ? x.title : `Chapter ${cc}`; };
  let title = titleOf(c);
  document.title = `${n.title} - ${title} | Novelxplin`;
  $("#rtTitle").innerHTML = `<a href="${U.novel(n.slug)}">${esc(n.title)}</a> <span style="color:var(--muted)">/ ${esc(title)}</span>`;

  function nav() {
    const sel = `<select onchange="location.href=this.value" aria-label="Jump to chapter">${index.map(ch => `<option value="${link(ch.num)}" ${ch.num === c ? "selected" : ""}>${esc(ch.title || "Chapter " + ch.num)}</option>`).join("")}</select>`;
    return `<a class="btn alt ${c <= 1 ? "disabled" : ""}" href="${link(c - 1)}">${I.left} Prev</a>
      <a class="btn ghost" href="${U.novel(n.slug)}">${I.list} Index</a>
      ${sel}
      <a class="btn ${c >= n.chapters ? "disabled" : ""}" href="${link(c + 1)}">Next ${I.right}</a>`;
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
            ${c > 1 ? `<a class="btn ghost" href="${link(c - 1)}">${I.left} Previous</a>` : ""}
            ${c < n.chapters ? `<a class="btn" href="${link(c + 1)}">Next chapter ${I.right}</a>` : `<a class="btn" href="${U.novel(n.slug)}">${I.check} You're all caught up</a>`}
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
    c = cc; title = titleOf(c); Lib.mark(n.id, c);
    document.title = `${n.title} - ${title} | Novelxplin`;
    $("#rtTitle").innerHTML = `<a href="${U.novel(n.slug)}">${esc(n.title)}</a> <span style="color:var(--muted)">/ ${esc(title)}</span>`;
    $("#navTop").innerHTML = nav(); $("#navBottom").innerHTML = nav();
    renderChapter(ch);
    try { history.pushState({ c }, "", link(c)); } catch { }
    scrollTo(0, 0);
    if (c < n.chapters) DB.chapter(n.slug, c + 1).catch(() => { });
  }
  addEventListener("popstate", () => location.reload());

  // share
  async function share() {
    const data = { title: document.title, text: `${n.title} – ${title}`, url: location.href };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(location.href); toast("Link copied"); } } catch { }
  }
  $("#shareBtn")?.addEventListener("click", share);

  // prefetch next chapter (API + HTML) so "Next" feels instant
  if (c < n.chapters) {
    const pf = u => { const l = document.createElement("link"); l.rel = "prefetch"; l.href = u; document.head.appendChild(l); };
    pf(`/api/novels/${encodeURIComponent(n.slug)}/chapters/${c + 1}`);
    pf(link(c + 1));
  }

  /* ---------- settings ---------- */
  const DEF = { theme: "paper", size: 18, font: "serif", lh: 1.8, width: 860, align: "left", pspace: 1.1, autoSpeed: 2, ttsRate: 1, ttsVoice: "", ttsEngine: "edge", edgeVoice: "en-US-AriaNeural", gLang: "en" };
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

  // text-to-speech – 3 engines, all run on the user's device (zero server load)
  //   edge   : Microsoft neural voices via WebSocket (edge-tts protocol)
  //   google : Google Translate voice (gTTS)             device : browser speechSynthesis
  // Edge/Google audio is played through a single <audio> element → keeps playing with the
  // screen off / app in background, lock-screen controls via Media Session, auto next chapter.
  const ttsBtn = $("#tTts"), ttsBar = $("#ttsBar");
  const synth = window.speechSynthesis;
  const TT = window.NXTTS;
  let ttsOn = false, ttsIdx = 0, utter = null, ttsSeq = 0, paused = false;
  const pEls = () => $$("#content p[data-i]");
  const savePrefs = () => localStorage.setItem("nx_reader", JSON.stringify(prefs));
  if (!["edge", "google", "device"].includes(prefs.ttsEngine)) prefs.ttsEngine = "edge";
  if (!TT) prefs.ttsEngine = "device";

  // single shared audio element (created on user gesture so mobile allows autoplay chain)
  const audio = document.createElement("audio"); audio.preload = "auto"; audio.setAttribute("playsinline", ""); audio.setAttribute("referrerpolicy", "no-referrer"); try { audio.referrerPolicy = "no-referrer"; } catch { } document.body.appendChild(audio);
  const cache = new Map(); // paragraph index → audio URL list (prefetched)
  let queue = [], qi = 0, blobUrls = [];
  const relBlobs = () => { blobUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch { } }); blobUrls = []; };
  // 0.1s of silence – played synchronously inside the user's tap so later play() calls (after async synthesis,
  // on "ended", and after in-place chapter change) are allowed by mobile autoplay policies.
  const SILENCE = (() => { const n = 800, b = new Uint8Array(44 + n), v = new DataView(b.buffer), w = (o, s) => [...s].forEach((ch, i) => b[o + i] = ch.charCodeAt(0)); w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true); b.fill(128, 44); return URL.createObjectURL(new Blob([b], { type: "audio/wav" })); })();
  let unlocked = false;
  const unlock = () => { if (unlocked) return; audio.src = SILENCE; audio.play().then(() => { unlocked = true; }).catch(() => { }); };

  function pickVoice() {
    const vs = synth ? synth.getVoices() : [];
    return vs.find(v => v.name === prefs.ttsVoice) || vs.find(v => /^en/i.test(v.lang) && /Google|Natural|Premium/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || vs[0];
  }
  function fillVoices() {
    const s = $("#ttsVoice"); if (!s) return;
    let opts = "";
    if (prefs.ttsEngine === "edge") { if (!TT.EDGE_VOICES.some(v => v[0] === prefs.edgeVoice)) prefs.edgeVoice = "en-US-AriaNeural"; opts = TT.EDGE_VOICES.map(v => `<option value="${v[0]}" ${v[0] === prefs.edgeVoice ? "selected" : ""}>${v[1]}</option>`).join(""); }
    else if (prefs.ttsEngine === "google") { if (!TT.GOOGLE_LANGS.some(v => v[0] === prefs.gLang)) prefs.gLang = "en"; opts = TT.GOOGLE_LANGS.map(v => `<option value="${v[0]}" ${v[0] === prefs.gLang ? "selected" : ""}>${v[1]}</option>`).join(""); }
    else { const vs = synth ? synth.getVoices().filter(v => /^(en|hi)/i.test(v.lang)) : []; opts = vs.map(v => `<option value="${esc(v.name)}" ${v.name === prefs.ttsVoice ? "selected" : ""}>${esc(v.name.replace(/^Microsoft |^Google /, ""))} (${esc(v.lang)})</option>`).join("") || "<option>Default</option>"; }
    s.innerHTML = opts;
    const eng = $("#ttsEngine"); if (eng) { eng.value = prefs.ttsEngine; if (!TT) eng.disabled = true; }
  }
  if (synth) synth.onvoiceschanged = () => { if (prefs.ttsEngine === "device") fillVoices(); };
  fillVoices();

  const voiceArg = () => prefs.ttsEngine === "edge" ? prefs.edgeVoice : prefs.gLang;
  const cacheKey = i => `${prefs.ttsEngine}|${voiceArg()}|${prefs.ttsEngine === "edge" ? prefs.ttsRate : 1}|${i}`;
  async function getAudio(i) {
    const k = cacheKey(i); if (cache.has(k)) return cache.get(k);
    const p = TT.synthesize(prefs.ttsEngine, pEls()[i].textContent, voiceArg(), prefs.ttsRate).then(urls => { if (prefs.ttsEngine === "edge") blobUrls.push(...urls); return urls; });
    cache.set(k, p); p.catch(() => cache.delete(k));
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return p;
  }
  function highlight(i) {
    const els = pEls(); els.forEach(p => p.classList.remove("speaking"));
    if (els[i]) { els[i].classList.add("speaking"); if (document.visibilityState === "visible") els[i].scrollIntoView({ block: "center", behavior: "smooth" }); }
    const s = $("#ttsStatus"); if (s) s.textContent = `${i + 1}/${els.length}`;
  }
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
  function playQueue(seq) {
    if (seq !== ttsSeq || qi >= queue.length) return;
    audio.src = queue[qi]; audio.playbackRate = prefs.ttsEngine === "google" ? prefs.ttsRate : 1;
    const st = $("#ttsStatus"); if (st) st.textContent = `${ttsIdx + 1}/${pEls().length}`;
    audio.play().catch(() => { if (seq === ttsSeq) { toast("Tap Resume to start listening"); togglePause(true); } });
  }
  audio.addEventListener("ended", () => { if (audio.src === SILENCE) return; qi++; if (qi < queue.length) playQueue(ttsSeq); else if (ttsOn) speak(ttsIdx + 1); });
  audio.addEventListener("error", () => { if (!ttsOn || !audio.src || audio.src === SILENCE) return; toast("Audio failed – trying next paragraph"); qi++; if (qi < queue.length) playQueue(ttsSeq); else speak(ttsIdx + 1); });

  async function nextChapter() {
    if (c >= n.chapters) { setTts(false); toast("You're all caught up"); return; }
    const st = $("#ttsStatus"); if (st) st.textContent = "next…";
    const seq = ttsSeq;
    try {
      cache.clear(); relBlobs();
      await loadChapter(c + 1);
      if (!ttsOn || seq !== ttsSeq) return;
      toast(`Now playing: ${title}`);
      speak(0);
    } catch (e) { toast("Could not load next chapter"); setTts(false); }
  }
  async function speak(i) {
    const els = pEls(); if (i >= els.length) { nextChapter(); return; }
    ttsIdx = i; highlight(i); paused = false; $("#ttsPause").textContent = "Pause";
    const seq = ++ttsSeq;
    if (prefs.ttsEngine === "device") {
      if (!synth) { toast("Device voice not supported here – switch to Edge/Google"); return; }
      synth.cancel();
      utter = new SpeechSynthesisUtterance(els[i].textContent);
      utter.rate = prefs.ttsRate; const v = pickVoice(); if (v) utter.voice = v;
      utter.onend = () => { if (ttsOn && seq === ttsSeq) speak(i + 1); };
      utter.onerror = e => { if (e.error !== "interrupted" && e.error !== "canceled") setTts(false); };
      synth.speak(utter); return;
    }
    const st = $("#ttsStatus"); if (st) st.textContent = "…";
    try {
      queue = await getAudio(i); qi = 0;
      if (seq !== ttsSeq || !ttsOn) return;
      playQueue(seq); setMedia("playing");
      // prefetch next 2 paragraphs so playback never stalls
      for (let k = 1; k <= 2; k++) if (i + k < els.length) getAudio(i + k).catch(() => { });
    } catch (e) {
      if (seq !== ttsSeq) return;
      console.warn("TTS", e);
      if (prefs.ttsEngine === "edge") { toast("Edge voice unavailable – switched to Google voice"); prefs.ttsEngine = "google"; savePrefs(); fillVoices(); speak(i); }
      else if (synth) { toast("Online voice failed – using device voice"); prefs.ttsEngine = "device"; savePrefs(); fillVoices(); speak(i); }
      else { toast("Text-to-speech failed: " + e.message); setTts(false); }
    }
  }
  function togglePause(p) {
    if (!ttsOn) return;
    paused = p; $("#ttsPause").textContent = p ? "Resume" : "Pause";
    if (prefs.ttsEngine === "device") { p ? synth.pause() : synth.resume(); }
    else { p ? audio.pause() : audio.play().catch(() => { }); }
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = p ? "paused" : "playing";
  }
  function setTts(on, from) {
    ttsOn = on; ttsBtn.classList.toggle("active", on); ttsBar.hidden = !on;
    ttsSeq++; if (synth) synth.cancel();
    audio.pause();
    if (on && prefs.ttsEngine !== "device") unlock(); else { audio.removeAttribute("src"); audio.load(); }
    if (on) { $("#ttsRateVal").textContent = prefs.ttsRate + "x"; speak(from ?? ttsIdx); }
    else { pEls().forEach(p => p.classList.remove("speaking")); relBlobs(); cache.clear(); if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "none"; }
  }
  ttsBtn.addEventListener("click", () => setTts(!ttsOn));
  ttsBar.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "ttsPrev") setTts(true, Math.max(0, ttsIdx - 1));
    if (b.id === "ttsNext") setTts(true, ttsIdx + 1);
    if (b.id === "ttsStop") setTts(false);
    if (b.id === "ttsPause") togglePause(!paused);
    if (b.dataset.rate) { prefs.ttsRate = Math.max(.5, Math.min(2, +(prefs.ttsRate + +b.dataset.rate).toFixed(1))); savePrefs(); $("#ttsRateVal").textContent = prefs.ttsRate + "x"; if (prefs.ttsEngine === "google") audio.playbackRate = prefs.ttsRate; else setTts(true, ttsIdx); }
  });
  $("#ttsEngine")?.addEventListener("change", e => { prefs.ttsEngine = e.target.value; savePrefs(); cache.clear(); fillVoices(); if (ttsOn) setTts(true, ttsIdx); });
  $("#ttsVoice")?.addEventListener("change", e => {
    if (prefs.ttsEngine === "edge") prefs.edgeVoice = e.target.value; else if (prefs.ttsEngine === "google") prefs.gLang = e.target.value; else prefs.ttsVoice = e.target.value;
    savePrefs(); cache.clear(); if (ttsOn) setTts(true, ttsIdx);
  });
  // click a paragraph while TTS is on → start reading from there
  content.addEventListener("click", e => {
    const p = e.target.closest("p[data-i]");
    if (ttsOn && p) { setTts(true, +p.dataset.i); return; }
    if (document.body.classList.contains("focus-mode") && !e.target.closest("a,button")) setFocus(false);
  });
  addEventListener("beforeunload", () => { synth && synth.cancel(); relBlobs(); });

  /* ---------- keyboard + swipe navigation ---------- */
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { if (!panel.hidden) setOpen(false); else if (document.body.classList.contains("focus-mode")) setFocus(false); }
    if (e.key === "ArrowLeft" && c > 1) location.href = link(c - 1);
    if (e.key === "ArrowRight" && c < n.chapters) location.href = link(c + 1);
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
    if (dx < 0 && c < n.chapters) { toast("Next chapter →"); location.href = link(c + 1); }
    else if (dx > 0 && c > 1) { toast("← Previous chapter"); location.href = link(c - 1); }
  }, { passive: true });

  /* ---------- comments – Firestore when available, else local ---------- */
  const ckey = `nx_comments_${n.id}_${c}`;
  const colors = ["#e67e22", "#1e73be", "#2e9e4f", "#7e57c2", "#e53935"];
  const col = window.firebase && Auth.enabled ? firebase.firestore().collection("comments").doc(n.slug).collection(String(c)) : null;
  const show = list => $("#comments").innerHTML = list.length ? list.map((cm, i) => `<div class="comment"><div class="avatar" style="background:${colors[i % colors.length]}">${esc((cm.who || "?")[0])}</div><div><div class="who">${esc(cm.who)}<small>${DB.timeAgo(Math.round((Date.now() - cm.at) / 6e4))}</small></div><p>${esc(cm.text)}</p></div></div>`).join("") : `<p style="color:var(--muted);font-size:12px;margin-top:10px">No comments yet. Be the first!</p>`;
  async function renderComments() {
    if (col) { try { const s = await Promise.race([col.orderBy("at", "desc").limit(50).get(), new Promise((_, rej) => setTimeout(() => rej(new Error("comments timeout")), 8000))]); return show(s.docs.map(d => d.data())); } catch (e) { console.warn(e); } }
    show(JSON.parse(localStorage.getItem(ckey) || "[]"));
  }
  $("#cPost").addEventListener("click", async () => {
    const u = Auth.user(); if (!u) { openLogin(); return; }
    const t = $("#cText").value.trim(); if (!t) return;
    const cm = { who: u.name, uid: u.uid || "", text: t.slice(0, 2000), at: Date.now() };
    if (col) { try { await col.add(cm); } catch (e) { toast("Failed: " + e.message); return; } }
    else { const list = JSON.parse(localStorage.getItem(ckey) || "[]"); list.unshift(cm); localStorage.setItem(ckey, JSON.stringify(list)); }
    $("#cText").value = ""; renderComments(); toast("Comment posted");
  });
  renderComments();
});
