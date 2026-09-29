// Construction de web.fetch : un seul fichier, dist/web-fetch.mjs, point d'entrée de l'image.
// - Les imports propres à OpenClaw vont vers src/openclaw-shims/ (alias).
// - L'extracteur Readability d'OpenClaw charge @mozilla/readability et linkedom/worker par
//   import(CONSTANTE) : esbuild ne suit pas un nom de module dans une variable, et le fichier
//   construit dépendrait alors de node_modules (sans eux, l'extraction retomberait en silence
//   sur extractBasicHtmlContent). Le texte chargé depuis third_party/ est donc réécrit, au
//   moment de la construction seulement, en import("nom littéral") : même module, même
//   comportement, et le fichier sur disque reste intact (empreintes de PROVENANCE.json).
import { readFile } from "node:fs/promises";
import { build } from "esbuild";

const EXTRACTOR = /third_party[\\/]openclaw[\\/]extensions[\\/]web-readability[\\/]web-content-extractor\.ts$/;
const LITERAL_IMPORTS = [
  ["import(READABILITY_MODULE)", 'import("@mozilla/readability")'],
  ["import(LINKEDOM_MODULE)", 'import("linkedom/worker")'],
];

const literalImports = {
  name: "openclaw-literal-imports",
  setup(b) {
    b.onLoad({ filter: EXTRACTOR }, async (args) => {
      let contents = await readFile(args.path, "utf8");
      for (const [from, to] of LITERAL_IMPORTS) {
        const count = contents.split(from).length - 1;
        if (count !== 1) throw new Error(`${from} attendu une fois dans ${args.path}, trouvé ${count} fois : code d'OpenClaw changé ?`);
        contents = contents.replace(from, to);
      }
      return { contents, loader: "ts" };
    });
  },
};

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/web-fetch.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "inline",
  logLevel: "warning",
  alias: {
    "openclaw/plugin-sdk/lazy-runtime": "./src/openclaw-shims/lazy-runtime.ts",
    "openclaw/plugin-sdk/web-content-extractor": "./src/openclaw-shims/web-content-extractor.ts",
    "@openclaw/normalization-core/utf16-slice": "./src/openclaw-shims/utf16-slice.ts",
    "@openclaw/normalization-core/string-coerce": "./src/openclaw-shims/string-coerce.ts",
  },
  // Des dépendances CommonJS regroupées dans un module ES peuvent appeler require().
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  plugins: [literalImports],
});
