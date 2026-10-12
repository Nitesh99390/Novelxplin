/* =========================================================
   Zero-dependency EPUB → chapters parser (Node.js).
   Mirrors the browser-side logic in admin.html (JSZip + DOMParser)
   using a tiny ZIP reader + regex based XML/HTML handling, so the
   Telegram bot can import books without any npm packages.

   parseEpub(buffer) → { meta:{title,author}, chapters:[{num,title,body}] }
   ========================================================= */
const zlib = require("zlib");

/* ---------- minimal ZIP reader (stored + deflate) ---------- */
function readZip(buf) {
  // find End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("Not a valid EPUB/ZIP file");
  let count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  // zip64?
  if (count === 0xffff || cdOff === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      count = Number(buf.readBigUInt64LE(z64 + 32)); cdOff = Number(buf.readBigUInt64LE(z64 + 48));
    }
  }
  const files = {};
  let p = cdOff;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString("utf8");
    files[name] = { method, csize, usize, lho };
    p += 46 + nlen + elen + clen;
  }
  const get = name => {
    const f = files[name] || files[decodeURIComponent(name)];
    if (!f) return null;
    const h = f.lho;
    if (buf.readUInt32LE(h) !== 0x04034b50) return null;
    const nlen = buf.readUInt16LE(h + 26), elen = buf.readUInt16LE(h + 28);
    const start = h + 30 + nlen + elen;
    const data = buf.slice(start, start + f.csize);
    if (f.method === 0) return data;
    if (f.method === 8) return zlib.inflateRawSync(data);
    throw new Error("Unsupported ZIP compression in EPUB");
  };
  return { names: Object.keys(files), get, text: n => { const d = get(n); return d ? d.toString("utf8") : null; } };
}

/* ---------- tiny XML/HTML helpers ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", laquo: "«", raquo: "»", bull: "•", middot: "·", trade: "™", reg: "®", shy: "", ensp: " ", emsp: " ", thinsp: " " };
const decode = s => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { try { return String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)); } catch { return m; } }
  return ENT[e.toLowerCase()] !== undefined ? ENT[e.toLowerCase()] : m;
});
const attrs = tag => { const o = {}; tag.replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (m, k, a, b) => { o[k.toLowerCase()] = decode(a !== undefined ? a : b); return ""; }); return o; };
const tagText = (xml, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml); return m ? decode(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : ""; };
const dirOf = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
const normPath = p => { const out = []; for (const seg of p.split("/")) { if (seg === "..") out.pop(); else if (seg && seg !== ".") out.push(seg); } return out.join("/"); };

const BLOCK = "p|div|h[1-6]|li|blockquote|pre|section|article|tr|hr|br|dt|dd|ul|ol|table|aside|figcaption|header|footer";
function htmlToText(html) {
  let s = String(html);
  const bm = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(s); if (bm) s = bm[1];
  s = s.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|nav|svg|figure|img|title)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*\/?>/gi, "")
    .replace(/<[^>]+(epub:type\s*=\s*["']pagebreak["']|role\s*=\s*["']doc-pagebreak["']|class\s*=\s*["'][^"']*pagenum[^"']*["'])[^>]*>[\s\S]*?<\/[^>]+>/gi, "")
    .replace(new RegExp(`</?(${BLOCK})\\b[^>]*>`, "gi"), "\n")
    .replace(/<[^>]+>/g, "");
  s = decode(s);
  return s.split("\n").map(l => l.replace(/[ \t\u00a0]+/g, " ").trim()).filter(Boolean).join("\n\n");
}
function heading(html) {
  const m = /<(h[1-4])\b[^>]*>([\s\S]*?)<\/\1>/i.exec(html) || /<[^>]+class\s*=\s*["'][^"']*(?:chapter-title|title)[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(html);
  return m ? decode(m[m.length - 1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : "";
}

/* ---------- EPUB ---------- */
const CH_RE = /^\s*(?:chapter|ch\.?|第)\s*(\d+)\s*(?:章|话|話)?\s*[:：\-–—.]?\s*(.*)$/i;
const SKIP_RE = /^(cover|title ?page|copyright|contents|table of contents|toc|dedication|acknowledg(e)?ments|about the author|colophon|imprint|epigraph|also by|preface|foreword|front ?matter|back ?matter|landmarks|guide)$/i;
const SKIP_FILE_RE = /(^|\/)(cover|titlepage|title_page|toc|nav|copyright|contents|colophon|frontmatter|backmatter)[^\/]*\.x?html?$/i;

function parseEpub(buffer) {
  const zip = readZip(buffer);
  const container = zip.text("META-INF/container.xml") || "";
  const rf = /<rootfile\b[^>]*>/i.exec(container);
  const opfPath = rf && attrs(rf[0])["full-path"];
  if (!opfPath) throw new Error("Invalid EPUB: no rootfile");
  const opfDir = dirOf(opfPath);
  const opf = zip.text(opfPath); if (!opf) throw new Error("Invalid EPUB: missing OPF");
  const meta = { title: tagText(opf, "dc:title") || tagText(opf, "title"), author: tagText(opf, "dc:creator") };

  const manifest = {};
  const manSrc = (/<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(opf) || [, opf])[1];
  for (const m of manSrc.matchAll(/<item\b[^>]*>/gi)) { const a = attrs(m[0]); if (a.id) manifest[a.id] = { href: a.href || "", type: a["media-type"] || "", props: a.properties || "" }; }
  const spineSrc = /<spine\b([^>]*)>([\s\S]*?)<\/spine>/i.exec(opf);
  const spine = [];
  if (spineSrc) for (const m of spineSrc[2].matchAll(/<itemref\b[^>]*>/gi)) { const a = attrs(m[0]); if (a.linear === "no") continue; const it = manifest[a.idref]; if (it && /html|xml/i.test(it.type) && !/nav/.test(it.props)) spine.push(it); }
  if (!spine.length) throw new Error("EPUB has no readable content");

  // TOC titles
  const tocTitles = {};
  try {
    const navItem = Object.values(manifest).find(m => /nav/.test(m.props));
    const ncxId = spineSrc && attrs("<spine" + spineSrc[1] + ">").toc;
    const ncxItem = (ncxId && manifest[ncxId]) || Object.values(manifest).find(m => /ncx/i.test(m.type));
    if (navItem) {
      const navPath = normPath(opfDir + navItem.href); const nav = zip.text(navPath) || "";
      for (const m of nav.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) { const p = normPath(dirOf(navPath) + m[1]); if (!tocTitles[p]) tocTitles[p] = decode(m[2].replace(/<[^>]+>/g, "")).trim(); }
    } else if (ncxItem) {
      const ncxPath = normPath(opfDir + ncxItem.href); const ncx = zip.text(ncxPath) || "";
      for (const m of ncx.matchAll(/<navPoint\b[^>]*>([\s\S]*?)<\/navPoint>/gi)) {
        const lbl = tagText(m[1], "text"); const c = /<content\b[^>]*>/i.exec(m[1]); const src = c && attrs(c[0]).src;
        if (src && lbl) { const p = normPath(dirOf(ncxPath) + src.split("#")[0]); if (!tocTitles[p]) tocTitles[p] = lbl; }
      }
    }
  } catch { }

  const chapters = [];
  for (const item of spine) {
    const path = normPath(opfDir + item.href);
    if (SKIP_FILE_RE.test(path)) continue;
    const html = zip.text(path); if (!html) continue;
    const h = heading(html);
    let title = h || tocTitles[path] || tagText(html, "title") || "";
    if (SKIP_RE.test(title) || /^the project gutenberg/i.test(title)) continue;
    let text = htmlToText(html);
    if (title && text.toLowerCase().startsWith(title.toLowerCase())) text = text.slice(title.length).replace(/^\s+/, "");
    if (text.replace(/\s/g, "").length < 200) continue;
    const m = CH_RE.exec(title) || CH_RE.exec(text.split("\n")[0]);
    chapters.push({ num: m ? +m[1] : null, title: title.slice(0, 300), body: text });
  }
  return { meta, chapters };
}

module.exports = { parseEpub, readZip, htmlToText };
