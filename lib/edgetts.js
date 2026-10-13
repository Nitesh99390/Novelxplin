/* =========================================================
   Microsoft Edge "Read aloud" neural TTS client – zero dependencies.
   • Implements the Oct-2026 Sec-MS-GEC **v2** token (CS64 + SHA-256).
   • Minimal RFC-6455 WebSocket client (https upgrade + masked frames), so it
     works on Node 18/20/22 without `ws` or the experimental global WebSocket.
   • Microsoft now rejects non-Edge User-Agents, which is why the browser can
     no longer talk to the service directly – the server does it instead.
   ========================================================= */
"use strict";
const https = require("https");
const crypto = require("crypto");

const TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM = "143.0.3650.75";
const GEC_VERSION = `2-${CHROMIUM}`;
const PREFIX = "Copyright (C) Microsoft Corporation. All rights reserved.";
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM.split(".")[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM}`;
const ORIGIN = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const HOSTS = [
  { host: "speech.platform.bing.com", path: "/consumer/speech/synthesize/readaloud/edge/v1", key: "TrustedClientToken" },
  { host: "api.msedgeservices.com", path: "/tts/cognitiveservices/websocket/v1", key: "Ocp-Apim-Subscription-Key" }
];

/* ---------- Sec-MS-GEC v2 ---------- */
const u32 = v => v >>> 0, rol16 = v => (((v << 16) | (v >>> 16)) >>> 0), mul = (a, b) => Math.imul(a, b) >>> 0;
function words(bytes) {
  const n = Math.ceil(bytes.length / 4) * 4, p = Buffer.alloc(n); bytes.copy(p);
  const w = []; for (let i = 0; i < n; i += 4) w.push(p.readUInt32LE(i)); if (w.length % 2) w.push(0); return w;
}
function wordSwap(w, k) {
  const a = (k[0] | 1) >>> 0, b = (k[1] | 1) >>> 0; let acc = 0, last = 0;
  for (let i = 0; i < w.length; i += 2) {
    const x = w[i], y = w[i + 1];
    let t = u32(mul(rol16(x), 0xEF0569FB) + mul(x, a)); t = rol16(t); let q = mul(t, 0x76F50F34); q = u32(mul(rol16(q), 0xC3EFEA97) + q); acc = u32(acc + q);
    t = u32(mul(rol16(y), 0xC31713DB) + mul(y, b)); t = rol16(t); q = mul(t, 0x1881CE3C); last = u32(mul(rol16(q), 0x35BD1EC9) + q); acc = u32(acc + last);
  }
  return [last, acc];
}
function reversible(w, k) {
  const a = (k[0] | 1) >>> 0, b = (k[1] | 1) >>> 0; let st = 0, acc = 0;
  for (let i = 0; i < w.length; i += 2) {
    const x = w[i], y = w[i + 1];
    st = mul(u32(st + x), a); for (const c of [0xCF98B111, 0x87085B9F, 0x12CEB96D, 0x257E1D83]) st = mul(rol16(st), c);
    let t = mul(u32(y + st), b); t = mul(rol16(t), 0xA27416F5); t = mul(rol16(t), 0xD38396FF); t = rol16(t);
    acc = u32(acc + st); st = mul(rol16(mul(t, 0x7C932B89)), 0xBFA49F69); acc = u32(acc + st);
  }
  return [st, acc];
}
let clockSkew = 0; // seconds, adjusted from the server Date header after a 403
function gecV2() {
  let ticks = Date.now() / 1000 + clockSkew + 11644473600; ticks -= ticks % 300; ticks *= 1e7;
  const data = Buffer.from(PREFIX + ticks.toFixed(0) + TOKEN, "ascii");
  const dig = crypto.createHash("sha256").update(data).digest();
  const dw = words(data), kw = words(dig), A = wordSwap(dw, kw), B = reversible(dw, kw);
  const cs = Buffer.alloc(8); cs.writeUInt32LE((A[0] ^ B[0]) >>> 0, 0); cs.writeUInt32LE((A[1] ^ B[1]) >>> 0, 4);
  return `${cs.toString("hex").toUpperCase()}-${dig.toString("hex").toUpperCase()}`;
}

/* ---------- tiny WebSocket client ---------- */
function frame(opcode, payload) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const mask = crypto.randomBytes(4), len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, 0x80 | len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 0x80 | 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 0x80 | 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
  const body = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) body[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([head, mask, body]);
}
function connect(h, timeout) {
  return new Promise((resolve, reject) => {
    const path = `${h.path}?${h.key}=${TOKEN}&Sec-MS-GEC=${gecV2()}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${crypto.randomBytes(16).toString("hex")}`;
    const req = https.request({
      host: h.host, path, headers: {
        Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
        "User-Agent": UA, Origin: ORIGIN, Pragma: "no-cache", "Cache-Control": "no-cache", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate, br"
      }
    });
    req.setTimeout(timeout, () => { req.destroy(new Error("Edge TTS connect timeout")); });
    req.on("upgrade", (res, socket) => resolve(socket));
    req.on("response", res => {
      const date = Date.parse(res.headers.date || ""); if (date) clockSkew = Math.round(date / 1000 - Date.now() / 1000);
      res.resume(); req.destroy(); reject(Object.assign(new Error(`Edge TTS handshake ${res.statusCode}`), { status: res.statusCode }));
    });
    req.on("error", reject); req.end();
  });
}
const xml = s => String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));

/**
 * synthesize(text, voice, { rate, pitch, timeout }) → Promise<Buffer> (mp3 24 kHz 48 kbps mono)
 * rate: multiplier (1 = normal). pitch: e.g. "+0Hz".
 */
async function synthesize(text, voice, opts = {}) {
  const timeout = opts.timeout || 25000;
  const r = Math.round(((opts.rate || 1) - 1) * 100);
  const lang = voice.split("-").slice(0, 2).join("-");
  const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody pitch='${opts.pitch || "+0Hz"}' rate='${r >= 0 ? "+" : ""}${r}%' volume='+0%'>${xml(text)}</prosody></voice></speak>`;
  let lastErr;
  for (const h of HOSTS) {
    let socket;
    try { socket = await connect(h, timeout); }
    catch (e) { lastErr = e; continue; } // try the other host (403 / network)
    return await new Promise((resolve, reject) => {
      const chunks = []; let buf = Buffer.alloc(0), done = false, frag = null, fragOp = 0;
      const finish = (err, out) => { if (done) return; done = true; clearTimeout(timer); try { socket.write(frame(8, Buffer.from([0x03, 0xe8]))); } catch { } socket.destroy(); err ? reject(err) : resolve(out); };
      const timer = setTimeout(() => finish(new Error("Edge TTS timeout")), timeout);
      const onMessage = (op, data) => {
        if (op === 1) { if (data.toString("utf8").includes("Path:turn.end")) { if (!chunks.length) return finish(new Error("Edge TTS returned no audio")); finish(null, Buffer.concat(chunks)); } return; }
        if (op === 2) { if (data.length < 2) return; const hl = data.readUInt16BE(0); const header = data.subarray(2, 2 + hl).toString("utf8"); if (header.includes("Path:audio")) chunks.push(Buffer.from(data.subarray(2 + hl))); }
      };
      socket.on("data", d => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          if (buf.length < 2) return;
          const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80; let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = buf.readUInt32BE(2) * 0x100000000 + buf.readUInt32BE(6); off = 10; }
          if (masked) off += 4;
          if (buf.length < off + len) return;
          let payload = buf.subarray(off, off + len);
          if (masked) { const m = buf.subarray(off - 4, off); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
          buf = buf.subarray(off + len);
          if (op === 8) return finish(chunks.length ? null : new Error("Edge TTS closed: " + (payload.length >= 2 ? payload.readUInt16BE(0) : "?")), chunks.length ? Buffer.concat(chunks) : undefined);
          if (op === 9) { try { socket.write(frame(10, payload)); } catch { } continue; }
          if (op === 10) continue;
          if (op === 0) { if (frag) { frag.push(payload); if (fin) { onMessage(fragOp, Buffer.concat(frag)); frag = null; } } continue; }
          if (!fin) { frag = [payload]; fragOp = op; continue; }
          onMessage(op, payload);
        }
      });
      socket.on("error", e => finish(e));
      socket.on("close", () => finish(chunks.length ? null : new Error("Edge TTS connection closed"), chunks.length ? Buffer.concat(chunks) : undefined));
      const ts = new Date().toString();
      socket.write(frame(1, `X-Timestamp:${ts}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`));
      socket.write(frame(1, `X-RequestId:${crypto.randomBytes(16).toString("hex")}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${ts}Z\r\nPath:ssml\r\n\r\n${ssml}`));
    });
  }
  throw lastErr || new Error("Edge TTS unavailable");
}

module.exports = { synthesize, gecV2, VOICE_RE: /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]{2,40}Neural$/ };
