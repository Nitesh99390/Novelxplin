/* Page entry: admin.html (generated from inline script) */
import "../skeleton.js";
import "../config.js";
import "../data.js";
import "../app.js";

document.addEventListener("app:ready", async () => {
  const { $, $$, esc, q, U, breadcrumb, I } = UI;
  $("#crumb").innerHTML = breadcrumb([{ label: "Home", href: U.home }, { label: "Admin" }]);
  const gate = $("#gate");
  const user = Auth.user();
  const devToken = new URLSearchParams(location.search).get("dev");
  if (!devToken && (!user || !Auth.isAdmin())) {
    gate.style.display = ""; gate.innerHTML = `<div class="empty">${I.user}<div>${user ? `Signed in as <b>${esc(user.email)}</b> – this account is not an admin.<br><small style="color:var(--muted)">Ask the site owner to add this email in Admin → Admins, then sign in again.</small>` : "Admin area. Please sign in with an admin Google account."}<br><br>${user ? `<a href="#" id="gOut" style="color:var(--link)">Sign out</a>` : `<button class="btn" id="gIn">${I.user} Sign in</button>`}</div></div>`;
    $("#gIn")?.addEventListener("click", openLogin); $("#gOut")?.addEventListener("click", async e => { e.preventDefault(); await Auth.logout(); location.reload(); });
    return;
  }
  $("#panelWrap").style.display = "";
  $("#nTitle").innerHTML = `${I.pen} Novel details`; $("#lTitle").innerHTML = `${I.list} Novels`; $("#tTitle").innerHTML = `${I.shelf} Tools`; $("#cTitle").innerHTML = `${I.book} Chapters`;
  $("#novelForm select[name=lang]").innerHTML = DB.LANGS.map(l => `<option>${esc(l)}</option>`).join("");
  $("#genreBoxes").innerHTML = DB.GENRES.map(g => `<label><input type="checkbox" name="g" value="${esc(g)}">${esc(g)}</label>`).join("");

  const authHdr = async () => ({ Authorization: "Bearer " + (devToken || await Auth.token()) });
  async function call(method, path, body, raw) {
    const h = await authHdr(); if (!raw) h["Content-Type"] = "application/json";
    const r = await fetch((NX_CONFIG.API_BASE || "") + path, { method, headers: h, body: raw ? body : body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j;
  }
  fetch((NX_CONFIG.API_BASE || "") + "/api/health").then(r => r.json()).then(h => $("#health").textContent = `${h.novels} novels · RAM ${(h.mem / 1048576).toFixed(0)} MB · up ${(h.uptime / 3600).toFixed(1)} h`).catch(() => $("#health").textContent = "unreachable");

  // ---- admin management (owner only) ----
  (async () => {
    let me = { owner: !!devToken || Auth.isOwner() };
    try { me = await call("GET", "/api/me"); } catch { }
    if (!me.owner) return;
    const panel = $("#adminsPanel"); panel.style.display = "";
    $("#aTitle").innerHTML = `${I.user} Admins`;
    const myEmail = (user && user.email || "").toLowerCase();
    // best-effort mirror into Firestore admins/{email} so firestore.rules can grant comment moderation
    const fsAdmins = window.firebase && Auth.enabled && !devToken ? firebase.firestore().collection("admins") : null;
    const mirror = (em, on) => { if (!fsAdmins) return; (on ? fsAdmins.doc(em).set({ email: em, addedBy: myEmail, addedAt: Date.now() }) : fsAdmins.doc(em).delete()).catch(e => console.warn("admins mirror", e.message)); };
    function renderAdmins(d) {
      const rows = [
        ...d.owners.map(e => `<div class="row"><div class="t"><b class="truncate">${esc(e)}</b><small>Owner · can manage admins</small></div><span class="pill owner">owner</span></div>`),
        ...d.admins.map(a => `<div class="row"><div class="t"><b class="truncate">${esc(a.email)}</b><small>Added ${esc((a.addedAt || "").slice(0, 10))}${a.addedBy ? " by " + esc(a.addedBy) : ""}</small></div><a href="#" class="pill danger" data-rm="${esc(a.email)}" title="Remove admin">✕</a></div>`)
      ];
      $("#aCount").textContent = `${d.owners.length + d.admins.length} total`;
      $("#adminList").innerHTML = rows.join("") || `<div class="hint">No extra admins yet.</div>`;
      $$("[data-rm]").forEach(a => a.addEventListener("click", async e => {
        e.preventDefault(); const em = a.dataset.rm;
        if (!confirm(`Remove admin access from\n\n${em}\n\nThey will no longer be able to upload or edit novels.`)) return;
        try { renderAdmins(await call("DELETE", `/api/admins/${encodeURIComponent(em)}`)); mirror(em, false); toast("Admin removed"); } catch (err) { toast(err.message); }
      }));
    }
    try { renderAdmins(await call("GET", "/api/admins")); } catch (err) { $("#adminList").innerHTML = `<div class="hint">${esc(err.message)}</div>`; }
    $("#addAdminForm").addEventListener("submit", async e => {
      e.preventDefault(); const f = e.target; const em = f.email.value.trim().toLowerCase();
      if (!em) return;
      if (em === myEmail) return toast("You are already the owner");
      if (!confirm(`Make this email an admin?\n\n${em}\n\nWhen this Google account signs in it will automatically get the Admin panel and can upload / edit / delete novels.`)) return;
      try { renderAdmins(await call("POST", "/api/admins", { email: em })); mirror(em, true); f.reset(); toast(`${em} is now an admin`); } catch (err) { toast(err.message); }
    });
  })();

  let novels = DB.novels.slice(); let cur = null;
  const nf = $("#novelForm");
  function renderList() {
    const f = $("#filter").value.toLowerCase();
    const list = novels.filter(n => !f || n.title.toLowerCase().includes(f));
    $("#lCount").textContent = `${novels.length} total`;
    $("#novelList").innerHTML = list.length ? list.map(n => `<div class="row ${cur && cur.slug === n.slug ? "active" : ""}" data-s="${n.slug}"><div class="t"><b class="truncate">${esc(n.title)}</b><small>${n.chapters} ch · ${esc(n.status)}</small></div><span class="pill ${n.status === "Completed" ? "ok" : ""}">${esc(n.author || "—")}</span></div>`).join("") : `<div class="hint">No novels yet.</div>`;
    $$("#novelList .row").forEach(r => r.addEventListener("click", () => select(novels.find(n => n.slug === r.dataset.s))));
  }
  $("#filter").addEventListener("input", renderList);

  function fill(n) {
    cur = n;
    nf.slug.value = n ? n.slug : ""; nf.title.value = n ? n.title : ""; nf.author.value = n ? n.author || "" : ""; nf.lang.value = n ? n.lang : DB.LANGS[0];
    nf.status.value = n ? n.status : "Ongoing"; nf.rating.value = n ? (n.baseRating !== undefined ? n.baseRating : n.rating) || 0 : 0; nf.summary.value = n ? (Array.isArray(n.summary) ? n.summary.join("\n") : n.summary || "") : "";
    nf.cover.value = n ? n.cover || "" : ""; nf.hot.checked = !!(n && n.hot); $("#coverPrev").src = (n && n.cover) || "";
    $$("#genreBoxes input").forEach(b => b.checked = !!(n && n.genres.includes(b.value)));
    $("#delNovel").style.display = n ? "" : "none"; $("#saveNovel").textContent = n ? "Update novel" : "Create novel";
    $("#chapPanel").style.display = n ? "" : "none";
    if (n) { $("#cTitle").innerHTML = `${I.book} Chapters – ${esc(n.title)}`; loadChapters(); }
    renderList();
  }
  function select(n) { fill(n); history.replaceState(null, "", (n ? U.admin(n.slug) : U.admin()) + (devToken ? "?dev=" + encodeURIComponent(devToken) : "")); }
  $("#newBtn").addEventListener("click", e => { e.preventDefault(); select(null); });

  $("#coverFile").addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await call("POST", "/api/upload", f, true); nf.cover.value = r.url; $("#coverPrev").src = r.url; toast("Cover uploaded"); } catch (err) { toast(err.message); }
  });
  nf.cover.addEventListener("change", () => $("#coverPrev").src = nf.cover.value);

  nf.addEventListener("submit", async e => {
    e.preventDefault();
    const body = { title: nf.title.value, author: nf.author.value, lang: nf.lang.value, status: nf.status.value, rating: +nf.rating.value, summary: nf.summary.value, cover: nf.cover.value, hot: nf.hot.checked, genres: $$("#genreBoxes input:checked").map(b => b.value) };
    try {
      if (cur) { const n = await call("PUT", `/api/novels/${cur.slug}`, body); Object.assign(cur, n); toast("Novel updated"); }
      else { const n = await call("POST", "/api/novels", body); novels.unshift(n); toast("Novel created – now add chapters"); select(n); return; }
      renderList();
    } catch (err) { toast(err.message); }
  });
  $("#delNovel").addEventListener("click", async () => {
    if (!cur || !confirm(`Delete "${cur.title}" and ALL its chapters? This cannot be undone.`)) return;
    try { await call("DELETE", `/api/novels/${cur.slug}`); novels = novels.filter(n => n.slug !== cur.slug); toast("Deleted"); select(null); } catch (err) { toast(err.message); }
  });

  // ---- chapters ----
  let chaps = [];
  async function loadChapters() {
    chaps = await DB.chapters(cur.slug).catch(() => []);
    cur.chapters = chaps.length; $("#cCount").textContent = `${chaps.length} chapters`;
    $("#chapList").innerHTML = chaps.length ? [...chaps].reverse().map(c => `<div class="row"><div class="t"><b class="truncate">${esc(c.title)}</b><small>#${c.num} · ${esc((c.date || "").slice(0, 10))}</small></div><a href="${U.chapter(cur.slug, c.num)}" target="_blank" class="pill">view</a><a href="#" class="pill" data-edit="${c.num}">edit</a><a href="#" class="pill danger" data-del="${c.num}">✕</a></div>`).join("") : `<div class="hint">No chapters yet – upload some above.</div>`;
    $$("[data-del]").forEach(a => a.addEventListener("click", async e => { e.preventDefault(); if (!confirm(`Delete chapter ${a.dataset.del}?`)) return; try { await call("DELETE", `/api/novels/${cur.slug}/chapters/${a.dataset.del}`); toast("Chapter deleted"); loadChapters(); } catch (err) { toast(err.message); } }));
    $$("[data-edit]").forEach(a => a.addEventListener("click", async e => { e.preventDefault(); const ch = await DB.chapter(cur.slug, a.dataset.edit); const cf = $("#chapForm"); cf.num.value = ch.num; cf.title.value = ch.title; cf.body.value = (ch.body || []).join("\n\n"); cf.closest("details").open = true; cf.scrollIntoView({ behavior: "smooth" }); }));
    renderList();
  }
  $("#chapForm").addEventListener("submit", async e => {
    e.preventDefault(); const cf = e.target;
    const body = { num: cf.num.value ? +cf.num.value : undefined, title: cf.title.value, body: cf.body.value };
    if (!body.body.trim()) return toast("Body is empty");
    try {
      if (body.num && chaps.some(c => c.num === body.num)) await call("PUT", `/api/novels/${cur.slug}/chapters/${body.num}`, body);
      else await call("POST", `/api/novels/${cur.slug}/chapters`, body);
      cf.reset(); toast("Chapter saved"); loadChapters();
    } catch (err) { toast(err.message); }
  });

  // bulk upload
  const drop = $("#drop"), fileIn = $("#chapFiles"), prog = $("#prog");
  drop.addEventListener("click", e => { if (e.target === drop || e.target.tagName === "B" || e.target.tagName === "SPAN" || e.target.tagName === "CODE") fileIn.click(); });
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => handleFiles([...e.dataTransfer.files]));
  fileIn.addEventListener("change", e => handleFiles([...e.target.files]));

  // ---- EPUB parsing (client side, via JSZip) ----
  const CH_RE = /^\s*(?:chapter|ch\.?|第)\s*(\d+)\s*(?:章|话|話)?\s*[:：\-–—.]?\s*(.*)$/i;
  const SKIP_RE = /^(cover|title ?page|copyright|contents|table of contents|toc|dedication|acknowledg(e)?ments|about the author|colophon|imprint|epigraph|also by|preface|foreword|front ?matter|back ?matter|landmarks|guide)$/i;
  const SKIP_FILE_RE = /(^|\/)(cover|titlepage|title_page|toc|nav|copyright|contents|colophon|frontmatter|backmatter)[^\/]*\.x?html?$/i;
  const dirOf = p => p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "";
  const normPath = p => { const out = []; for (const seg of p.split("/")) { if (seg === "..") out.pop(); else if (seg && seg !== ".") out.push(seg); } return out.join("/"); };
  const xmlDoc = (s, type) => new DOMParser().parseFromString(s, type || "application/xml");

  // Convert an XHTML chapter document into plain text (one paragraph per line, blank line between)
  function htmlToText(doc) {
    const root = doc.body || doc.documentElement;
    root.querySelectorAll("script,style,nav,svg,img,figure,header .pagenum,.pagenum,[epub\\:type=pagebreak],[role=doc-pagebreak]").forEach(n => n.remove());
    const BLOCK = new Set(["P","DIV","H1","H2","H3","H4","H5","H6","LI","BLOCKQUOTE","PRE","SECTION","ARTICLE","TR","HR","BR","DT","DD","UL","OL","TABLE","ASIDE","FIGCAPTION"]);
    let out = "";
    const walk = n => {
      if (n.nodeType === 3) { out += n.nodeValue.replace(/\s+/g, " "); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toUpperCase(); const blk = BLOCK.has(tag);
      if (blk) out += "\n";
      if (tag === "BR" || tag === "HR") { out += "\n"; return; }
      for (const c of n.childNodes) walk(c);
      if (blk) out += "\n";
    };
    walk(root);
    return out.split("\n").map(l => l.trim()).filter(Boolean).join("\n\n");
  }

  async function parseEpub(file) {
    if (!window.JSZip) throw new Error("JSZip failed to load – check internet connection");
    const zip = await JSZip.loadAsync(file);
    const read = async p => { const f = zip.file(p) || zip.file(decodeURIComponent(p)); if (!f) throw new Error("Missing file in EPUB: " + p); return f.async("string"); };
    // 1. container.xml → OPF path
    const container = xmlDoc(await read("META-INF/container.xml"));
    const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
    if (!opfPath) throw new Error("Invalid EPUB: no rootfile");
    const opfDir = dirOf(opfPath);
    const opf = xmlDoc(await read(opfPath));
    const meta = { title: opf.getElementsByTagName("dc:title")[0]?.textContent?.trim() || opf.querySelector("title")?.textContent?.trim() || "", author: opf.getElementsByTagName("dc:creator")[0]?.textContent?.trim() || "" };
    // 2. manifest + spine (reading order)
    const manifest = {}; opf.querySelectorAll("manifest > item").forEach(it => manifest[it.getAttribute("id")] = { href: it.getAttribute("href"), type: it.getAttribute("media-type") || "", props: it.getAttribute("properties") || "" });
    const spine = [...opf.querySelectorAll("spine > itemref")].filter(r => r.getAttribute("linear") !== "no").map(r => manifest[r.getAttribute("idref")]).filter(m => m && /html|xml/i.test(m.type) && !/nav/.test(m.props));
    if (!spine.length) throw new Error("EPUB has no readable content");
    // 3. TOC titles (EPUB3 nav or EPUB2 NCX) keyed by file path
    const tocTitles = {};
    try {
      const navItem = Object.values(manifest).find(m => /nav/.test(m.props));
      const ncxId = opf.querySelector("spine")?.getAttribute("toc"); const ncxItem = ncxId && manifest[ncxId] || Object.values(manifest).find(m => /ncx/i.test(m.type));
      if (navItem) { const nav = xmlDoc(await read(normPath(opfDir + navItem.href)), "application/xhtml+xml"); nav.querySelectorAll("nav a[href]").forEach(a => { const p = normPath(dirOf(normPath(opfDir + navItem.href)) + a.getAttribute("href").split("#")[0]); if (!tocTitles[p]) tocTitles[p] = a.textContent.trim(); }); }
      else if (ncxItem) { const ncx = xmlDoc(await read(normPath(opfDir + ncxItem.href))); ncx.querySelectorAll("navPoint").forEach(np => { const src = np.querySelector("content")?.getAttribute("src"); const lbl = np.querySelector("navLabel text, text")?.textContent?.trim(); if (src && lbl) { const p = normPath(dirOf(normPath(opfDir + ncxItem.href)) + src.split("#")[0]); if (!tocTitles[p]) tocTitles[p] = lbl; } }); }
    } catch (e) { console.warn("TOC parse failed", e); }
    // 4. walk spine → chapters
    const chapters = [];
    for (const item of spine) {
      const path = normPath(opfDir + item.href);
      if (SKIP_FILE_RE.test(path)) continue;
      let html; try { html = await read(path); } catch { continue; }
      let doc = xmlDoc(html, "application/xhtml+xml");
      if (doc.querySelector("parsererror") || !doc.body) doc = xmlDoc(html, "text/html");
      const heading = doc.querySelector("h1,h2,h3,h4,.chapter-title,.title")?.textContent?.replace(/\s+/g, " ").trim() || "";
      let title = heading || tocTitles[path] || doc.querySelector("title")?.textContent?.trim() || "";
      if (SKIP_RE.test(title) || /^the project gutenberg/i.test(title)) continue;
      let text = htmlToText(doc);
      // strip the heading line if it is the first line of body
      if (title && text.toLowerCase().startsWith(title.toLowerCase())) text = text.slice(title.length).replace(/^\s+/, "");
      if (text.replace(/\s/g, "").length < 200) continue; // too short → not a real chapter (cover, blank, ads…)
      const m = CH_RE.exec(title) || CH_RE.exec(text.split("\n")[0]);
      chapters.push({ num: m ? +m[1] : null, title, body: text });
    }
    return { meta, chapters };
  }

  async function handleFiles(files) {
    files = files.filter(f => /\.epub$/i.test(f.name) || f.type === "application/epub+zip");
    if (!files.length) return toast("Only .epub files are accepted");
    if (!cur) return toast("Select a novel first");
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    prog.style.display = ""; const bar = prog.firstElementChild; let total = 0;
    const existing = new Set(chaps.map(c => c.num)); let next = chaps.length ? chaps[chaps.length - 1].num + 1 : 1;
    let batch = []; let overwriteAll = null;
    const flush = async () => { if (!batch.length) return; const r = await call("POST", `/api/novels/${cur.slug}/chapters`, { chapters: batch }); total += r.saved.length; batch = []; };
    try {
      for (const f of files) {
        toast(`Reading ${f.name}…`); bar.style.width = "5%";
        const { chapters } = await parseEpub(f);
        if (!chapters.length) { toast(`No chapters found in ${f.name}`); continue; }
        // assign numbers: use detected numbers when they form a sane sequence, else sequential
        // use heading numbers only when every section has one and they are unique – otherwise number sequentially
        const useDetected = chapters.every(c => c.num !== null) && new Set(chapters.map(c => c.num)).size === chapters.length;
        chapters.forEach(c => { if (!useDetected || c.num === null) { c.num = next++; } else next = Math.max(next, c.num + 1); if (!c.title) c.title = `Chapter ${c.num}`; });
        if (!confirm(`Found ${chapters.length} chapter(s) in "${f.name}" (${chapters[0].num} → ${chapters[chapters.length - 1].num}). Upload to "${cur.title}"?`)) continue;
        let i = 0;
        for (const it of chapters) {
          if (existing.has(it.num)) { if (overwriteAll === null) overwriteAll = confirm(`Some chapters already exist (e.g. #${it.num}). Overwrite existing chapters?`); if (!overwriteAll) { i++; continue; } }
          batch.push(it); if (batch.length >= 25) await flush();
          i++; bar.style.width = Math.round(5 + i / chapters.length * 95) + "%";
        }
        await flush();
      }
      toast(`Uploaded ${total} chapter(s)`);
    } catch (err) { console.error(err); toast("Upload failed: " + err.message); }
    prog.style.display = "none"; bar.style.width = "0"; fileIn.value = ""; loadChapters();
  }

  $("#backupBtn").addEventListener("click", async e => {
    e.preventDefault(); toast("Preparing backup…");
    try { const r = await fetch((NX_CONFIG.API_BASE || "") + "/api/backup", { headers: await authHdr() }); if (!r.ok) throw new Error((await r.json()).error); const b = await r.blob(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `novelxplin-backup-${new Date().toISOString().slice(0, 10)}.json.gz`; a.click(); } catch (err) { toast(err.message); }
  });

  renderList();
  const pre = q.get("n") && novels.find(n => n.slug === q.get("n"));
  fill(pre || null);
});
