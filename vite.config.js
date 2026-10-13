/* =========================================================
   Novelxplin – Vite build (vanilla JS, no framework)
   • src/            → source (HTML, css/, js/, public/)
   • dist/           → production output served by server.js
   • Every page is a Rollup input (MPA). Shared code (config/data/app/skeleton)
     is split into hashed chunks; the reader/TTS code gets its own chunk.
   • After Rollup + esbuild minify, only OUR chunks (src/js/**) are run through
     javascript-obfuscator (identifier renaming + string-array encoding) so the
     token logic can't be read or trivially re-used by scrapers. Vendor code
     (node_modules) is left untouched – see obfuscatorPlugin.
   ========================================================= */
import { defineConfig } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import JavaScriptObfuscator from "javascript-obfuscator";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "src");

// Every *.html in src/ is an entry page (index, novel, read, admin, ...).
const pages = Object.fromEntries(
  readdirSync(SRC).filter(f => f.endsWith(".html")).map(f => [f.replace(/\.html$/, ""), resolve(SRC, f)])
);

/* ---------- obfuscator plugin (production only) ----------
   Only OUR source (src/js/**) is obfuscated. Third-party code (anything resolved from
   node_modules – Firebase SDK, polyfills, Vite's modulepreload helper …) is already public and
   obfuscating it just inflated the bundle 10× (500+ kB chunks) and froze low-end phones while
   the string-array decoder ran. Vendor modules are split into their own "vendor" chunk by
   manualChunks below so a chunk is never half ours / half theirs. */
const isVendor = id => /[\\/]node_modules[\\/]/.test(id) || id.startsWith("\0") || id.includes("vite/");
function obfuscatorPlugin(options) {
  return {
    name: "nx-javascript-obfuscator",
    apply: "build",
    enforce: "post",
    renderChunk(code, chunk) {
      if (!/\.js$/.test(chunk.fileName)) return null;
      const mods = Object.keys(chunk.modules || {});
      const ours = mods.filter(id => !isVendor(id) && /[\\/]src[\\/]js[\\/]/.test(id));
      if (!ours.length) return null;                       // pure vendor / helper chunk → leave as-is
      const result = JavaScriptObfuscator.obfuscate(code, options);
      return { code: result.getObfuscatedCode(), map: null };
    }
  };
}

/* "Balanced" profile: identifiers + strings are hidden so TTS / token logic can't be read or
   trivially re-used, but the two options that blew up size & CPU (control-flow flattening and
   dead-code injection → ~12× source size, several seconds of JS parse on a mid-range Android)
   are off. Resulting chunks are ~1.5–2× the minified source. */
const OBF = {
  compact: true,
  target: "browser",
  seed: 0,                                   // 0 = random every build
  // --- control flow ---
  controlFlowFlattening: false,
  deadCodeInjection: false,
  simplify: true,
  // --- identifiers ---
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,                      // keep window.DB / UI / Auth / NXTTS cross-chunk contracts
  renameProperties: false,                   // DOM / Firebase property names must survive
  transformObjectKeys: false,
  // --- strings ---
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: ["base64"],           // rc4 decode on every string access was the mobile hot-spot
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 1,
  stringArrayWrappersType: "variable",
  stringArrayWrappersChainedCalls: false,
  stringArrayCallsTransform: false,
  splitStrings: false,
  unicodeEscapeSequence: false,
  // --- anti-tamper / anti-debug ---
  selfDefending: false,                      // breaks under some mobile WebViews once esbuild re-minifies
  debugProtection: false,
  disableConsoleOutput: true,
  numbersToExpressions: false,
  // --- misc ---
  log: false,
  sourceMap: false
};

export default defineConfig(({ command }) => ({
  root: SRC,
  publicDir: resolve(SRC, "public"),          // src/public/img/favicon.svg → dist/img/favicon.svg
  base: "/",
  appType: "mpa",
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/uploads": "http://localhost:3000" }
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    target: "es2019",
    minify: "esbuild",
    sourcemap: false,
    cssCodeSplit: true,
    cssMinify: true,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: true },
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: pages,
      output: {
        // Next.js-style hashed filenames
        entryFileNames: "_nx/static/chunks/[name]-[hash].js",
        chunkFileNames: "_nx/static/chunks/[hash].js",
        assetFileNames: ({ name }) =>
          /\.css$/.test(name || "") ? "_nx/static/css/[hash][extname]" : "_nx/static/media/[name]-[hash][extname]",
        // Aggressive manual splitting: one chunk per shared module so pages only
        // pull what they need and the reader/TTS logic lives in its own file.
        manualChunks(id) {
          if (isVendor(id)) return "vendor";            // never obfuscated, cached forever
          if (id.includes("/src/js/config.js")) return "cfg";
          if (id.includes("/src/js/skeleton.js")) return "sk";
          if (id.includes("/src/js/data.js")) return "data";
          if (id.includes("/src/js/app.js")) return "ui";
          if (id.includes("/src/js/tts.js")) return "tts";
          if (id.includes("/src/js/reader.js")) return "reader";
        }
      }
    }
  },
  esbuild: { legalComments: "none", drop: command === "build" ? ["debugger"] : [] },
  plugins: [obfuscatorPlugin(OBF)]
}));
