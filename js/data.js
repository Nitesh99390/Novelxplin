/* =========================================================
   Mock data layer – replace with real API calls later.
   Everything the UI needs is exposed on window.DB
   ========================================================= */
(function () {
  const GENRES = [
    "Action", "Adult", "Adventure", "Comedy", "Drama", "Eastern", "Ecchi", "Fan-fic",
    "Fantasy", "Game", "Gender Bender", "Harem", "Historical", "Horror", "Josei",
    "Martial Arts", "Mature", "Mecha", "Mystery", "Psychological", "Reincarnation",
    "Romance", "School Life", "Sci-fi", "Seinen", "Shoujo", "Shounen Ai", "Shounen",
    "Slice of Life", "Smut", "Sports", "Supernatural", "System", "Tragedy", "Wuxia",
    "Xianxia", "Xuanhuan", "Yaoi"
  ];
  const GENRE_COLORS = { Action: "c-green", Adventure: "c-orange", Fantasy: "c-purple", "Martial Arts": "c-red", Romance: "c-red", System: "c-blue" };
  const LANGS = ["English Novel", "Chinese Novel", "Korean Novel", "Japanese Novel"];
  const STATUS = ["Ongoing", "Completed"];
  const PALETTE = ["#1f3a5f", "#5a1f3a", "#1f5a3a", "#4a3a1f", "#2d1f5a", "#5a2d1f", "#1f4a5a", "#3a3a3a", "#6b2c2c", "#2c4a6b", "#4b2c6b", "#2c6b4b", "#7a4a12", "#12527a", "#7a1240", "#334155"];
  const GLYPHS = ["⚔", "🐉", "🌙", "✦", "🔥", "❄", "⚡", "🌸", "🗡", "🏯", "☯", "🌌", "👑", "🩸", "🦊", "📜"];

  // original placeholder titles (generated combinations)
  const A = ["Reborn", "Supreme", "Infinite", "Celestial", "Immortal", "Shadow", "Divine", "Eternal", "Silent", "Crimson", "Abyssal", "Forgotten", "Hidden", "Fallen", "Rising", "Primordial", "Boundless", "Azure", "Heavenly", "Lonely"];
  const B = ["Sword", "Sovereign", "Alchemist", "Emperor", "Librarian", "Summoner", "Dragon", "Cultivator", "Villainess", "Archmage", "Beast Tamer", "Necromancer", "Merchant", "Knight", "Duchess", "Gamer", "Reaper", "Healer", "Blacksmith", "Oracle"];
  const C = ["of the Nine Realms", "Returns", "in Another World", "System", "Chronicles", "of Dawn", "Rebirth", "Ascension", "of the Fallen Star", "Legacy", "Online", "at the Academy", "Among Gods", "and the Thousand Doors", "of Midnight", "Awakening", "Hunts Alone", "Wants a Quiet Life", "Simulator", "Regression"];

  const AUTHORS = ["Moonlit Ink", "Silver Quill", "Rain Walker", "Wandering Brush", "Lantern Scribe", "Jade Pen", "Night Owl Writer", "Ember Tales", "Sora Kaneshiro", "Lin Xiaoyu", "Han Joon-ho", "Ariana Vale"];

  let seed = 20251011;
  function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
  function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
  function ri(min, max) { return Math.floor(rnd() * (max - min + 1)) + min; }
  function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""); }

  const CHAPTER_WORDS = ["The Gate", "A Quiet Morning", "Blood Oath", "Hidden Trial", "The Auction", "Return to the Sect", "First Blood", "Whispers", "Breaking Through", "The Merchant's Offer", "Storm Over the Capital", "Old Friends", "The Tower", "Beneath the Lake", "An Unexpected Guest", "Price of Power", "The Bet", "Night Raid", "Ashes", "Threshold"];

  const titlesUsed = new Set();
  const novels = [];
  let id = 1;
  while (novels.length < 84) {
    const title = `${pick(A)} ${pick(B)} ${pick(C)}`;
    if (titlesUsed.has(title)) continue;
    titlesUsed.add(title);
    const g1 = pick(GENRES); let g2 = pick(GENRES); while (g2 === g1) g2 = pick(GENRES);
    let g3 = pick(GENRES); while (g3 === g1 || g3 === g2) g3 = pick(GENRES);
    const chapters = ri(28, 3800);
    const status = rnd() < 0.3 ? "Completed" : "Ongoing";
    const rating = Math.round((rnd() * 3 + 2) * 10) / 10;
    const n = {
      id: id++,
      slug: slugify(title),
      title,
      author: pick(AUTHORS),
      lang: pick(LANGS),
      genres: [g1, g2, g3],
      chapters,
      status,
      rating: rnd() < 0.12 ? 0 : rating,
      votes: ri(5, 4200),
      views: ri(12000, 9800000),
      color: pick(PALETTE),
      glyph: pick(GLYPHS),
      hot: rnd() < 0.18,
      isNew: rnd() < 0.15,
      updatedMinutesAgo: ri(0, 60 * 24 * 6),
      summary: [
        `${title} follows a protagonist who wakes up to a world that no longer plays by the rules they remember. Armed with little more than stubbornness and a strange gift, they must navigate a hostile land where strength decides everything.`,
        `Along the way they gather unlikely allies, make enemies in high places, and slowly uncover a secret that ties their own past to the fate of the realm. Every victory comes with a price, and every price must eventually be paid.`,
        `This is a story about growth, loyalty, and the quiet determination to carve out a place in a world that would rather see you kneel.`
      ]
    };
    novels.push(n);
  }

  function chapterTitle(novel, idx) {
    // deterministic per novel+chapter
    const w = CHAPTER_WORDS[(novel.id * 7 + idx * 13) % CHAPTER_WORDS.length];
    const part = ((novel.id + idx) % 5 === 0) ? ` (${((idx % 3) + 1)})` : "";
    return `Chapter ${idx}: ${w}${part}`;
  }

  function chapterDate(novel, idx) {
    const d = new Date(Date.now() - (novel.chapters - idx) * 36e5 * 7 - novel.updatedMinutesAgo * 6e4);
    return d.toISOString().slice(0, 10);
  }

  function chapterBody(novel, idx) {
    const paras = [];
    const names = ["Ren", "Elder Mo", "Lia", "the innkeeper", "Captain Varro", "Sister Qing", "the boy", "Old Han"];
    const n1 = names[(novel.id + idx) % names.length];
    const n2 = names[(novel.id * 3 + idx) % names.length];
    paras.push(`${n1} stood at the edge of the courtyard, watching the morning mist crawl between the stone pillars. Somewhere beyond the wall a bell rang once, then fell silent.`);
    paras.push(`"You came back," ${n2} said without turning around. "I had a bet with myself that you wouldn't."`);
    paras.push(`"Then you owe yourself a drink." ${n1} tried to smile. It didn't quite reach the eyes. The pouch at the belt felt heavier than it should have, as if the thing inside were listening.`);
    paras.push(`They walked in silence for a while. The path narrowed, the trees pressed closer, and the air carried the faint iron smell that always came before trouble. ${n1} counted steps out of habit—forty, fifty, sixty—until the count lost meaning.`);
    paras.push(`"There is something you should know about the ${CHAPTER_WORDS[(idx * 3) % CHAPTER_WORDS.length].toLowerCase()}," ${n2} finally said. "It was never meant to be opened by one person alone."`);
    paras.push(`${n1} stopped. The words settled slowly, like dust after a collapse. Behind them, in the direction of the sect, a second bell rang—and this time it did not stop.`);
    paras.push(`Far above the canopy, unseen by either of them, a thin crack of light split the grey sky and vanished. The world, it seemed, had decided to start paying attention.`);
    return paras;
  }

  function timeAgo(mins) {
    if (mins < 1) return "just now";
    if (mins < 60) return mins === 1 ? "1 min ago" : `${mins} mins ago`;
    const h = Math.floor(mins / 60);
    if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
    const d = Math.floor(h / 24);
    return d === 1 ? "a day ago" : `${d} days ago`;
  }

  const byId = Object.fromEntries(novels.map(n => [n.id, n]));
  const bySlug = Object.fromEntries(novels.map(n => [n.slug, n]));

  window.DB = {
    GENRES, GENRE_COLORS, LANGS, STATUS, novels, byId, bySlug,
    chapterTitle, chapterDate, chapterBody, timeAgo,
    get(idOrSlug) { return byId[idOrSlug] || bySlug[idOrSlug] || null; },
    featured() { return [...novels].sort((a, b) => b.views - a.views).slice(0, 7); },
    latestRelease(limit) { return [...novels].sort((a, b) => a.updatedMinutesAgo - b.updatedMinutesAgo).slice(0, limit || novels.length); },
    latestNovels(limit) { return [...novels].sort((a, b) => b.id - a.id).slice(0, limit || novels.length); },
    mostPopular(limit) { return [...novels].sort((a, b) => b.views - a.views).slice(0, limit || novels.length); },
    completed(limit) { return novels.filter(n => n.status === "Completed").sort((a, b) => b.rating - a.rating).slice(0, limit || novels.length); },
    byGenre(g) { return novels.filter(n => n.genres.map(x => x.toLowerCase()).includes(String(g).toLowerCase())); },
    search(q) { q = String(q || "").trim().toLowerCase(); if (!q) return []; return novels.filter(n => n.title.toLowerCase().includes(q) || n.author.toLowerCase().includes(q) || n.genres.join(" ").toLowerCase().includes(q)); },
    rankByRating(limit) { return [...novels].filter(n => n.rating > 0).sort((a, b) => b.rating - a.rating).slice(0, limit || 10); }
  };
})();
