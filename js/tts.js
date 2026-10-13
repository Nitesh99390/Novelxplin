/* =========================================================
   Novelxplin – client-side TTS engines (zero server load)
   • "edge"   – Microsoft Edge neural voices, spoken to directly from the
                browser over WebSocket (same protocol as the edge-tts lib).
   • "google" – Google Translate TTS (what the gTTS library uses). Audio is
                streamed straight into an <audio> element (no fetch/CORS).
   • "device" – browser speechSynthesis (handled by reader.js).
   Everything runs on the user's phone/PC – the Oracle server never sees it.
   ========================================================= */
(function () {
  const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
  const GEC_VERSION = "1-143.0.3650.75";
  const WSS = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

  const EDGE_VOICES = [
    ["en-US-AriaNeural", "Aria (US, female)"], ["en-US-JennyNeural", "Jenny (US, female)"], ["en-US-AnaNeural", "Ana (US, young)"],
    ["en-US-GuyNeural", "Guy (US, male)"], ["en-US-ChristopherNeural", "Christopher (US, male)"], ["en-US-EricNeural", "Eric (US, male)"],
    ["en-GB-SoniaNeural", "Sonia (UK, female)"], ["en-GB-RyanNeural", "Ryan (UK, male)"], ["en-GB-ThomasNeural", "Thomas (UK, male)"],
    ["en-AU-NatashaNeural", "Natasha (AU, female)"], ["en-AU-WilliamNeural", "William (AU, male)"],
    ["en-IN-NeerjaNeural", "Neerja (India, female)"], ["en-IN-PrabhatNeural", "Prabhat (India, male)"],
    ["hi-IN-SwaraNeural", "Swara (Hindi, female)"], ["hi-IN-MadhurNeural", "Madhur (Hindi, male)"]
  ];
  const GOOGLE_LANGS = [["en", "English (US)"], ["en-GB", "English (UK)"], ["en-IN", "English (India)"], ["hi", "Hindi"]];

  /* ---- SHA-256 (fallback when crypto.subtle is unavailable on plain http) ---- */
  function sha256Hex(str) {
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const bytes = new TextEncoder().encode(str), l = bytes.length, bl = l * 8;
    const padLen = ((l + 9 + 63) >> 6) << 6, buf = new Uint8Array(padLen); buf.set(bytes); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(padLen - 4, bl >>> 0); dv.setUint32(padLen - 8, Math.floor(bl / 0x100000000));
    const w = new Uint32Array(64), rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < padLen; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c) ^ (b & c), t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
  }
  async function gecToken() {
    const sec = BigInt(Math.floor(Date.now() / 1000) + 11644473600);
    let ticks = sec * 10000000n; ticks -= ticks % 3000000000n;
    const s = `${ticks}${TOKEN}`;
    if (window.crypto && crypto.subtle) {
      try { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase(); } catch { }
    }
    return sha256Hex(s).toUpperCase();
  }
  const rid = () => { const a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256 | 0); return [...a].map(b => b.toString(16).padStart(2, "0")).join(""); };
  const xml = s => s.replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));

  /* ---- Edge neural TTS over WebSocket → Blob URL (mp3) ---- */
  async function edge(text, voice, rate) {
    const url = `${WSS}?TrustedClientToken=${TOKEN}&Sec-MS-GEC=${await gecToken()}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${rid()}`;
    const lang = (voice || "en-US-AriaNeural").split("-").slice(0, 2).join("-");
    const r = Math.round(((rate || 1) - 1) * 100);
    const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='+0Hz' rate='${r >= 0 ? "+" : ""}${r}%' volume='+0%'>${xml(text)}</prosody></voice></speak>`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url); ws.binaryType = "arraybuffer";
      const chunks = []; let done = false;
      const fail = m => { if (done) return; done = true; try { ws.close(); } catch { } reject(new Error(m)); };
      const timer = setTimeout(() => fail("Edge TTS timeout"), 20000);
      ws.onopen = () => {
        const ts = new Date().toString();
        ws.send(`X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`);
        ws.send(`X-RequestId:${rid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`);
      };
      ws.onmessage = ev => {
        if (typeof ev.data === "string") {
          if (ev.data.includes("Path:turn.end")) {
            done = true; clearTimeout(timer); ws.close();
            if (!chunks.length) return reject(new Error("Edge TTS returned no audio"));
            resolve(URL.createObjectURL(new Blob(chunks, { type: "audio/mpeg" })));
          }
          return;
        }
        const d = ev.data, hl = new DataView(d).getUint16(0);
        const header = new TextDecoder().decode(d.slice(2, 2 + hl));
        if (header.includes("Path:audio")) chunks.push(d.slice(2 + hl));
      };
      ws.onerror = () => fail("Edge TTS connection failed");
      ws.onclose = () => { if (!done) fail("Edge TTS closed early"); };
    });
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
  // Google returns 404 when a foreign Referer is sent. <audio referrerpolicy> is not honoured by
  // browsers, so the first time the Google engine is used we switch the document to no-referrer.
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
  async function synthesize(engine, text, voice, rate) {
    if (engine === "edge") return [await edge(text, voice, rate)];
    if (engine === "google") return google(text, voice);
    throw new Error("unknown engine");
  }

  window.NXTTS = { EDGE_VOICES, GOOGLE_LANGS, synthesize, edge, google };
})();
