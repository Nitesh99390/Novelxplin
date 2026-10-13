/* =========================================================
   Novelxplin – Listen engine (100 % client-side)
   Speech is produced by the browser's own Web Speech API (window.speechSynthesis).
   Nothing is proxied through our server: zero TTS bandwidth / CPU / memory on the VM.

   What this module does:
   • Waits for the (asynchronously populated) voice list and keeps it fresh.
   • Ranks voices so the best one is picked automatically – Google's offline/network
     voices on Android/Chrome ("Google हिन्दी", "Google US English", Chrome's
     "Natural"/"Online" voices), Apple's premium voices, Microsoft "Natural" voices …
   • Groups the voices for the picker: Hindi · English (India/US/UK/AU) · other Indian
     languages, each tagged ♀/♂ where the engine exposes a gender hint.
   • pick(prefName, lang, gender) → best SpeechSynthesisVoice for the request.
   ========================================================= */
(function () {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  const supported = !!(synth && typeof SpeechSynthesisUtterance !== "undefined");

  // Languages we surface in the picker (readers are Hindi / Indian-English first).
  const LANG_RE = /^(hi|en|mr|bn|ta|te|gu|kn|ml|pa|ur|ne)\b/i;
  const LANG_NAME = { hi: "हिन्दी · Hindi", en: "English", mr: "मराठी · Marathi", bn: "বাংলা · Bengali", ta: "தமிழ் · Tamil", te: "తెలుగు · Telugu", gu: "ગુજરાતી · Gujarati", kn: "ಕನ್ನಡ · Kannada", ml: "മലയാളം · Malayalam", pa: "ਪੰਜਾਬੀ · Punjabi", ur: "اردو · Urdu", ne: "नेपाली · Nepali" };
  const REGION = { IN: "India", US: "US", GB: "UK", AU: "Australia", CA: "Canada", IE: "Ireland", NZ: "New Zealand", ZA: "South Africa", PK: "Pakistan", BD: "Bangladesh", LK: "Sri Lanka", NP: "Nepal" };

  // Gender hints: engines rarely expose it, so we infer from well-known voice names.
  const FEMALE = /\b(female|woman|girl|swara|neerja|ananya|kajal|aarohi|tanishaa|pallavi|shruti|dhwani|sapna|sobhana|gul|ava|aria|jenny|emma|michelle|ana|sonia|libby|maisie|natasha|samantha|karen|moira|tessa|fiona|veena|lekha|zira|heera|kalpana|hazel|susan|catherine|zoe|allison|nicky|victoria|kate|serena|siri female|f\d?)\b/i;
  const MALE = /\b(male|man|boy|madhur|prabhat|arjun|rehaan|manohar|bashkar|valluvar|mohan|niranjan|gagan|midhun|salman|andrew|brian|guy|christopher|eric|roger|steffan|ryan|thomas|william|daniel|alex|fred|tom|rishi|ravi|hemant|david|mark|james|george|oliver|aaron|arthur|gordon|lee|m\d?)\b/i;
  const gender = v => (FEMALE.test(v.name) ? "♀" : MALE.test(v.name) ? "♂" : "");

  /* ---------- quality ranking ----------
     Higher = better. Google's Android voices + Chrome's "Natural"/"Online" voices sound far
     better than legacy eSpeak/Pico, and offline/local voices never stall on bad networks. */
  function score(v, wantLang) {
    let s = 0;
    const n = v.name || "", l = (v.lang || "").replace("_", "-");
    if (/google/i.test(n)) s += 50;                                   // Google TTS (Android / Chrome)
    if (/natural|neural|online|premium|enhanced|wavenet|journey|studio/i.test(n)) s += 40; // Edge/Chrome natural, Apple premium
    if (/microsoft/i.test(n) && /natural|online/i.test(n)) s += 10;
    if (/siri|apple/i.test(n) || /com\.apple\.(voice|ttsbundle)/.test(v.voiceURI || "")) s += 25;
    if (/espeak|pico|festival|compact|default|android tts/i.test(n)) s -= 40;   // robotic legacy engines
    if (v.localService) s += 8;                                       // works offline / no cold start
    if (v.default) s += 2;
    if (wantLang) {
      if (l.toLowerCase() === wantLang.toLowerCase()) s += 30;        // exact (hi-IN)
      else if (l.slice(0, 2).toLowerCase() === wantLang.slice(0, 2).toLowerCase()) s += 15; // same language
      if (/^en/i.test(wantLang) && /-IN$/i.test(l)) s += 5;          // Indian-English accent preferred for en
    }
    return s;
  }

  /* ---------- voice list (async on Chrome/Android) ---------- */
  let voices = [], readyRes, ready = new Promise(r => (readyRes = r));
  function refresh() {
    if (!supported) { readyRes([]); return []; }
    const all = synth.getVoices() || [];
    if (all.length) { voices = all.filter(v => LANG_RE.test(v.lang || "")); if (!voices.length) voices = all; readyRes(voices); }
    return voices;
  }
  if (supported) {
    refresh();
    synth.addEventListener ? synth.addEventListener("voiceschanged", () => { refresh(); listeners.forEach(f => { try { f(voices); } catch { } }); }) : (synth.onvoiceschanged = refresh);
    // Some Android WebViews never fire voiceschanged – poll briefly as a fallback.
    let tries = 0; const t = setInterval(() => { if (refresh().length || ++tries > 20) clearInterval(t); }, 250);
    setTimeout(() => readyRes(voices), 3000); // never block the UI forever
  }
  const listeners = new Set();
  const onChange = f => { listeners.add(f); return () => listeners.delete(f); };

  /* ---------- grouping for the picker ---------- */
  const niceName = v => String(v.name || "").replace(/^(Google|Microsoft|Apple)\s+/i, "").replace(/\s*\((?:[^()]*\bvoice\b[^()]*|Natural|Online|Enhanced|Premium)\)/gi, "").replace(/\s+-\s+.*$/, "").trim() || v.lang;
  const regionOf = v => { const m = /^[a-z]{2}[-_]([A-Za-z]{2})/.exec(v.lang || ""); return m ? (REGION[m[1].toUpperCase()] || m[1].toUpperCase()) : ""; };
  const isHQ = v => /google|natural|neural|online|premium|enhanced|wavenet|siri/i.test(v.name || "") || /com\.apple\.(voice|ttsbundle)/.test(v.voiceURI || "");
  /* → [{ group, voices: [[id, label, gender, voice]] }] – same shape the old picker consumed */
  function groups() {
    const vs = voices.length ? voices : refresh();
    const byKey = {};
    for (const v of vs) {
      const lang = (v.lang || "").slice(0, 2).toLowerCase();
      let key = LANG_NAME[lang] || v.lang;
      if (lang === "en") key = "English · " + (regionOf(v) || "Other");
      (byKey[key] = byKey[key] || []).push(v);
    }
    const order = k => /Hindi/.test(k) ? 0 : /English · India/.test(k) ? 1 : /English · US/.test(k) ? 2 : /English/.test(k) ? 3 : 4;
    return Object.keys(byKey).sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map(k => ({
      group: k,
      voices: byKey[k].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
        .map(v => [v.name, `${niceName(v)}${isHQ(v) ? " · HD" : ""}${v.localService ? "" : " · online"}`, gender(v), v])
    }));
  }
  const flat = gs => (gs || groups()).flatMap(g => g.voices);
  const has = (gs, id) => flat(gs).some(v => v[0] === id);
  const label = (gs, id) => { const v = flat(gs).find(v => v[0] === id); return v ? v[1] : id; };

  /* ---------- automatic selection ----------
     pick(name, lang, gender): exact saved voice → best voice for lang (+gender) → best Hindi → best English → anything. */
  function pick(name, lang, g) {
    const vs = voices.length ? voices : refresh();
    if (!vs.length) return null;
    if (name) { const v = vs.find(v => v.name === name || v.voiceURI === name); if (v) return v; }
    const rank = (want, gen) => vs.map(v => [v, score(v, want) + (gen && gender(v) === gen ? 20 : 0)]).sort((a, b) => b[1] - a[1]);
    const sameLang = want => vs.filter(v => (v.lang || "").slice(0, 2).toLowerCase() === want.slice(0, 2).toLowerCase());
    if (lang && sameLang(lang).length) return rank(lang, g)[0][0];
    if (sameLang("hi").length) return rank("hi-IN", g)[0][0];
    if (sameLang("en").length) return rank("en-IN", g)[0][0];
    return rank(lang || "en", g)[0][0];
  }
  /* Best voice for a paragraph: Devanagari → Hindi voice, otherwise the preferred/English voice. */
  const detectLang = t => /[\u0900-\u097F]/.test(t) ? "hi-IN" : /[\u0980-\u09FF]/.test(t) ? "bn-IN" : /[\u0A00-\u0A7F]/.test(t) ? "pa-IN" : /[\u0A80-\u0AFF]/.test(t) ? "gu-IN" : /[\u0B80-\u0BFF]/.test(t) ? "ta-IN" : /[\u0C00-\u0C7F]/.test(t) ? "te-IN" : /[\u0C80-\u0CFF]/.test(t) ? "kn-IN" : /[\u0D00-\u0D7F]/.test(t) ? "ml-IN" : /[\u0600-\u06FF]/.test(t) ? "ur-IN" : "en-IN";

  /* ---------- utterance factory ----------
     Chrome stops speaking long utterances (~15 s bug) – callers pass one paragraph at a time;
     we additionally split >240-char paragraphs at sentence boundaries. */
  function split(text, max = 240) {
    const out = []; let cur = "";
    for (const s of String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.!?;।])\s+/)) {
      if ((cur + " " + s).trim().length <= max) { cur = (cur + " " + s).trim(); continue; }
      if (cur) out.push(cur); cur = "";
      if (s.length <= max) { cur = s; continue; }
      for (const w of s.split(" ")) { if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
    }
    if (cur) out.push(cur);
    return out;
  }
  function utter(text, voice, rate, pitch) {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = detectLang(text);
    u.rate = Math.max(0.5, Math.min(2, +rate || 1));
    u.pitch = Math.max(0, Math.min(2, 1 + (+pitch || 0) / 50)); // our −50…+50 % → WebSpeech 0…2
    u.volume = 1;
    return u;
  }
  /* speak(text, opts) → Promise resolves on end, rejects on error. Splits long text, keeps one
     queue, and nudges Chrome (pause/resume) so it never goes silent mid-paragraph. */
  function speak(text, opts) {
    opts = opts || {};
    return new Promise((res, rej) => {
      if (!supported) return rej(new Error("Speech synthesis not supported in this browser"));
      const parts = split(text); if (!parts.length) return res();
      let i = 0, dead = false;
      const voice = opts.voice || pick(opts.voiceName, opts.lang || detectLang(text), opts.gender);
      const next = () => {
        if (dead) return;
        if (i >= parts.length) { clearInterval(keep); return res(); }
        const u = utter(parts[i++], voice, opts.rate, opts.pitch);
        if (opts.onboundary) u.onboundary = opts.onboundary;
        u.onend = next;
        u.onerror = e => { if (e.error === "interrupted" || e.error === "canceled") { dead = true; clearInterval(keep); return res(); } dead = true; clearInterval(keep); rej(new Error(e.error || "speech error")); };
        synth.speak(u);
      };
      // Chrome desktop stops after ~15 s of continuous speech unless nudged.
      const keep = setInterval(() => { if (synth.speaking && !synth.paused && /Chrome/.test(navigator.userAgent) && !/Android|Mobile/.test(navigator.userAgent)) { synth.pause(); synth.resume(); } }, 10000);
      if (opts.signal) opts.signal.addEventListener("abort", () => { dead = true; clearInterval(keep); synth.cancel(); res(); }, { once: true });
      next();
    });
  }
  const cancel = () => { if (supported) synth.cancel(); };
  const pause = () => { if (supported) synth.pause(); };
  const resume = () => { if (supported) synth.resume(); };

  window.NXTTS = { supported, ready, voices: () => (voices.length ? voices : refresh()), refresh, onChange, groups, flat, has, label, pick, gender, detectLang, split, utter, speak, cancel, pause, resume, score };
})();
