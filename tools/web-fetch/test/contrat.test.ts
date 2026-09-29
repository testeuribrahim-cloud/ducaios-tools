// Test minimal du contrat (tâche 1) : refus avant tout réseau. Les tests complets viennent avec la tâche 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
