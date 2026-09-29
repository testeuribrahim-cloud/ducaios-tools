// Contrat d'entrée et de sortie : par le vrai point d'entrée (refus avant tout réseau), puis par run() avec le banc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.js";
import { bench, DOMAIN, page, startServer } from "./support/harness.js";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Lance le vrai point d'entrée, demande sur l'entrée standard. */
function webFetch(stdin: string) {
  const run = spawnSync(process.execPath, ["--import", "tsx", "src/main.ts"], { cwd: TOOL, input: stdin, encoding: "utf8", timeout: 30_000 });
  const lines = run.stdout.trim().split("\n");
  return { code: run.status, lines, json: JSON.parse(lines.at(-1)!) as { error?: { code: string; message: string }; untrusted?: boolean }, stderr: run.stderr };
}

function assertRefused(stdin: string, code: string, message: RegExp) {
  const r = webFetch(stdin);
  assert.equal(r.code, 1, stdin);
  assert.equal(r.lines.length, 1, "un seul objet JSON sur la sortie standard");
  assert.equal(r.json.untrusted, true);
  assert.equal(r.json.error?.code, code, stdin);
  assert.match(r.json.error?.message ?? "", message);
  assert.match(r.stderr, /^web\.fetch : /);
}

test("entrée invalide : champ en plus, maxChars hors bornes, url absente → code 1 et JSON d'erreur", () => {
  assertRefused('{"url": "https://exemple.fr/", "mode": "markdown"}', "invalid_input", /champ inconnu « mode »/);
  for (const maxChars of ["99", "20001", "150.5", '"200"']) {
    assertRefused(`{"url": "https://exemple.fr/", "maxChars": ${maxChars}}`, "invalid_input", /maxChars/);
  }
  assertRefused("{}", "invalid_input", /« url »/);
  assertRefused('{"url": 42}', "invalid_input", /« url »/);
  assertRefused("[]", "invalid_input", /objet JSON/);
  assertRefused("pas du json", "invalid_input", /JSON illisible/);
});

test("schéma http: refusé, avec « interdit » dans le message", () => {
  assertRefused('{"url": "http://exemple.fr/"}', "forbidden_url", /interdit/);
});

// Sortie par le vrai run() du point d'entrée, avec le banc (serveur local, faux résolveur).

async function runWith(stdin: string, deps: Parameters<typeof run>[3]) {
  let stdout = "";
  let stderr = "";
  const code = await run((async function* () { yield stdin; })(), { write: (t: string) => { stdout += t; } }, { write: (t: string) => { stderr += t; } }, deps);
  return { code, stdout, stderr };
}

test("succès : code 0, un seul objet JSON avec exactement les champs du contrat ; bornes de maxChars acceptées", async () => {
  const server = await startServer();
  try {
    server.route(`contrat.${DOMAIN}`, "/", page("text/html; charset=utf-8", "<html><head><title>Titre</title></head><body><p>Bonjour.</p></body></html>"));
    for (const maxChars of [100, 20_000, undefined]) {
      const input = JSON.stringify({ url: `https://contrat.${DOMAIN}/`, ...(maxChars ? { maxChars } : {}) });
      const r = await runWith(input, bench(server).deps);
      assert.equal(r.code, 0, input);
      assert.equal(r.stderr, "");
      const lines = r.stdout.trim().split("\n");
      assert.equal(lines.length, 1, "un seul objet JSON");
      const out = JSON.parse(lines[0]!);
      assert.deepEqual(Object.keys(out), ["url", "finalUrl", "status", "contentType", "title", "text", "truncated", "bytes", "redirects", "untrusted"]);
      assert.deepEqual(
        { ...out, bytes: undefined },
        { url: `https://contrat.${DOMAIN}/`, finalUrl: `https://contrat.${DOMAIN}/`, status: 200, contentType: "text/html", title: "Titre", text: "Bonjour.", truncated: false, bytes: undefined, redirects: 0, untrusted: true },
      );
      assert.equal(typeof out.bytes, "number");
    }
  } finally {
    await server.close();
  }
});

test("erreur : code 1, un seul objet JSON {error, untrusted} sur la sortie standard, message court sur la sortie d'erreur", async () => {
  const deps = bench(undefined).deps;
  for (const [input, code] of [
    ['{"url": "https://127.0.0.1/"}', "non_public_address"],
    ['{"url": "https://exemple.test:8443/"}', "forbidden_url"],
    [JSON.stringify({ url: `https://exemple.test/${"a".repeat(70_000)}` }), "invalid_input"],
  ] as const) {
    const r = await runWith(input, deps);
    assert.equal(r.code, 1);
    const lines = r.stdout.trim().split("\n");
    assert.equal(lines.length, 1);
    const out = JSON.parse(lines[0]!);
    assert.deepEqual(Object.keys(out), ["error", "untrusted"]);
    assert.deepEqual(Object.keys(out.error), ["code", "message"]);
    assert.equal(out.error.code, code);
    assert.equal(out.untrusted, true);
    assert.equal(r.stderr, `web.fetch : ${out.error.message}\n`);
    assert.ok(r.stderr.length < 200, "message court");
  }
});
