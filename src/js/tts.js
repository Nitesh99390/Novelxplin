/* =========================================================
   Novelxplin – Listen engines
   • "edge"   – Microsoft Edge neural voices. Since Oct-2026 Microsoft only
                accepts the Edge browser itself, so the tiny Node server relays
                the request (/api/tts) and streams back MP3 (~50 KB/paragraph).
   • "google" – Google Translate TTS (what the gTTS library uses). Played
                straight from Google into <audio> – zero server load.
   • "device" – browser speechSynthesis (handled by reader.js).
   ========================================================= */
(function () {
  // [id, label, flag/lang, gender]  – grouped for the voice picker
  const EDGE_VOICES = [
    { group: "हिन्दी · Hindi", voices: [
      ["hi-IN-SwaraNeural", "Swara", "♀"], ["hi-IN-MadhurNeural", "Madhur", "♂"],
      ["en-US-AvaMultilingualNeural", "Ava · multilingual", "♀"], ["en-US-AndrewMultilingualNeural", "Andrew · multilingual", "♂"],
      ["en-US-EmmaMultilingualNeural", "Emma · multilingual", "♀"], ["en-US-BrianMultilingualNeural", "Brian · multilingual", "♂"]
    ] },
    { group: "English · India", voices: [["en-IN-NeerjaNeural", "Neerja", "♀"], ["en-IN-NeerjaExpressiveNeural", "Neerja · expressive", "♀"], ["en-IN-PrabhatNeural", "Prabhat", "♂"]] },
    { group: "English · US", voices: [
      ["en-US-AriaNeural", "Aria · novel", "♀"], ["en-US-JennyNeural", "Jenny", "♀"], ["en-US-MichelleNeural", "Michelle", "♀"], ["en-US-AnaNeural", "Ana · young", "♀"],
      ["en-US-GuyNeural", "Guy · novel", "♂"], ["en-US-ChristopherNeural", "Christopher", "♂"], ["en-US-EricNeural", "Eric", "♂"], ["en-US-RogerNeural", "Roger", "♂"], ["en-US-SteffanNeural", "Steffan", "♂"]
    ] },
    { group: "English · UK / AU", voices: [["en-GB-SoniaNeural", "Sonia", "♀"], ["en-GB-LibbyNeural", "Libby", "♀"], ["en-GB-MaisieNeural", "Maisie · young", "♀"], ["en-GB-RyanNeural", "Ryan", "♂"], ["en-GB-ThomasNeural", "Thomas", "♂"], ["en-AU-NatashaNeural", "Natasha", "♀"], ["en-AU-WilliamMultilingualNeural", "William", "♂"]] },
    { group: "भारतीय भाषाएँ · Indian languages", voices: [
      ["mr-IN-AarohiNeural", "Aarohi · मराठी", "♀"], ["mr-IN-ManoharNeural", "Manohar · मराठी", "♂"],
      ["bn-IN-TanishaaNeural", "Tanishaa · বাংলা", "♀"], ["bn-IN-BashkarNeural", "Bashkar · বাংলা", "♂"],
      ["ta-IN-PallaviNeural", "Pallavi · தமிழ்", "♀"], ["ta-IN-ValluvarNeural", "Valluvar · தமிழ்", "♂"],
      ["te-IN-ShrutiNeural", "Shruti · తెలుగు", "♀"], ["te-IN-MohanNeural", "Mohan · తెలుగు", "♂"],
      ["gu-IN-DhwaniNeural", "Dhwani · ગુજરાતી", "♀"], ["gu-IN-NiranjanNeural", "Niranjan · ગુજરાતી", "♂"],
      ["kn-IN-SapnaNeural", "Sapna · ಕನ್ನಡ", "♀"], ["kn-IN-GaganNeural", "Gagan · ಕನ್ನಡ", "♂"],
      ["ml-IN-SobhanaNeural", "Sobhana · മലയാളം", "♀"], ["ml-IN-MidhunNeural", "Midhun · മലയാളം", "♂"],
      ["ur-IN-GulNeural", "Gul · اردو", "♀"], ["ur-IN-SalmanNeural", "Salman · اردو", "♂"]
    ] }
  ];
  const GOOGLE_LANGS = [
    { group: "हिन्दी · Hindi", voices: [["hi", "Hindi · हिन्दी (Google)", "♀"]] },
    // Google Translate ships only one (female) Hindi voice – male options are relayed through the neural engine.
    { group: "हिन्दी · Male voices", voices: [["edge:hi-IN-MadhurNeural", "Madhur · पुरुष", "♂"], ["edge:en-US-AndrewMultilingualNeural", "Andrew · multilingual", "♂"], ["edge:en-US-BrianMultilingualNeural", "Brian · multilingual", "♂"], ["edge:en-IN-PrabhatNeural", "Prabhat · Indian English", "♂"]] },
    { group: "English", voices: [["en-IN", "English · India", ""], ["en", "English · US", ""], ["en-GB", "English · UK", ""], ["en-AU", "English · Australia", ""]] },
    { group: "भारतीय भाषाएँ · Indian languages", voices: [["mr", "Marathi · मराठी", ""], ["bn", "Bengali · বাংলা", ""], ["ta", "Tamil · தமிழ்", ""], ["te", "Telugu · తెలుగు", ""], ["gu", "Gujarati · ગુજરાતી", ""], ["kn", "Kannada · ಕನ್ನಡ", ""], ["ml", "Malayalam · മലയാളം", ""], ["pa", "Punjabi · ਪੰਜਾਬੀ", ""], ["ur", "Urdu · اردو", ""], ["ne", "Nepali · नेपाली", ""]] }
  ];
  const flat = groups => groups.flatMap(g => g.voices);
  const has = (groups, id) => flat(groups).some(v => v[0] === id);
  const label = (groups, id) => { const v = flat(groups).find(v => v[0] === id); return v ? v[1] : id; };

  /* ---- Edge neural via server relay → Blob URL (mp3) ---- */
  async function edge(text, voice, rate, signal, pitch) {
    const r = await fetch(`/api/tts?voice=${encodeURIComponent(voice)}&rate=${encodeURIComponent(rate || 1)}&pitch=${encodeURIComponent(pitch || 0)}&q=${encodeURIComponent(text)}`, { signal });
    if (!r.ok) { let m = `HTTP ${r.status}`; try { m = (await r.json()).error || m; } catch { } throw new Error(m); }
    const b = await r.blob();
    if (!b.size) throw new Error("Edge voice returned no audio");
    return URL.createObjectURL(b);
  }

  /* ---- Google Translate TTS (gTTS) → list of ≤200-char URLs ---- */
  function splitGoogle(text, max = 190) {
    const out = []; let cur = "";
    for (const s of text.replace(/\s+/g, " ").trim().split(/(?<=[.!?;:।])\s+/)) {
      if ((cur + " " + s).trim().length <= max) { cur = (cur + " " + s).trim(); continue; }
      if (cur) out.push(cur); cur = "";
      if (s.length <= max) { cur = s; continue; }
      for (const w of s.split(" ")) { if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
    }
    if (cur) out.push(cur);
    return out;
  }
  // Google returns 404 when a foreign Referer is sent → switch the document to no-referrer.
  function noReferrer() {
    if (document.querySelector('meta[name="referrer"]')) return;
    const m = document.createElement("meta"); m.name = "referrer"; m.content = "no-referrer"; document.head.appendChild(m);
  }
  function google(text, lang) {
    noReferrer();
    const parts = splitGoogle(text);
    return parts.map((p, i) => `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang || "en")}&total=${parts.length}&idx=${i}&textlen=${p.length}&q=${encodeURIComponent(p)}`);
  }

  /* synthesize → Promise<string[]> (audio URLs to play in order) */
  async function synthesize(engine, text, voice, rate, signal, pitch) {
    if (engine === "edge") return [await edge(text, voice, rate, signal, pitch)];
    if (engine === "google") {
      if (/^edge:/.test(voice)) return [await edge(text, voice.slice(5), rate, signal, pitch)]; // male Hindi via neural relay
      return google(text, voice);
    }
    throw new Error("unknown engine");
  }

  window.NXTTS = { EDGE_VOICES, GOOGLE_LANGS, flat, has, label, synthesize, edge, google };
})();
