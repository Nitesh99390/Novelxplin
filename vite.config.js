/* =========================================================
   Novelxplin – Vite build (vanilla JS, no framework)
   • src/            → source (HTML, css/, js/, public/)
   • dist/           → production output served by server.js
   • Every page is a Rollup input (MPA). Shared code (config/data/app/skeleton)
     is split into hashed chunks; the reader/TTS code gets its own chunk.
   • After Rollup + esbuild minify, every JS chunk is run through
     javascript-obfuscator (control-flow flattening, string array encoding,
     dead-code injection, self-defending) so the TTS / token logic can't be
     read or trivially re-used by scrapers.
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

/* ---------- obfuscator plugin (production only) ---------- */
function obfuscatorPlugin(options) {
  return {
    name: "nx-javascript-obfuscator",
    apply: "build",
    enforce: "post",
    renderChunk(code, chunk) {
      // Skip tiny loader-only chunks; obfuscate everything that carries logic.
      if (!/\.js$/.test(chunk.fileName)) return null;
      const result = JavaScriptObfuscator.obfuscate(code, options);
      return { code: result.getObfuscatedCode(), map: null };
    }
  };
}

const OBF = {
  compact: true,
  target: "browser",
  seed: 0,                                   // 0 = random every build
  // --- control flow ---
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  simplify: true,
  // --- identifiers ---
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,                      // keep window.DB / UI / Auth / NXTTS cross-chunk contracts
  renameProperties: false,                   // DOM / Firebase property names must survive
  transformObjectKeys: true,
  // --- strings ---
  stringArray: true,
  stringArrayThreshold: 1,
  stringArrayEncoding: ["rc4", "base64"],
  stringArrayRotate: true,
  stringArrayShuffle: true,
  stringArrayIndexShift: true,
  stringArrayWrappersCount: 3,
  stringArrayWrappersType: "function",
  stringArrayWrappersChainedCalls: true,
  stringArrayWrappersParametersMaxCount: 4,
  stringArrayCallsTransform: true,
  stringArrayCallsTransformThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 8,
  unicodeEscapeSequence: false,
  // --- anti-tamper / anti-debug ---
  selfDefending: true,
  debugProtection: false,                    // true would freeze DevTools; enable if you want to be hostile
  disableConsoleOutput: true,
  numbersToExpressions: true,
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
