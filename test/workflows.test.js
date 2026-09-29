import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".github/workflows";
const workflows = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ name: f, text: readFileSync(join(DIR, f), "utf8") }));

test("workflows : chaque action est épinglée par une empreinte de commit complète", () => {
  assert.ok(workflows.length > 0);
  for (const { name, text } of workflows) {
    const uses = [...text.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(uses.length > 0, name);
    for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name} : ${ref}`);
  }
});

test("workflows : aucun droit par défaut, aucun déclencheur pull_request_target", () => {
  for (const { name, text } of workflows) {
    assert.match(text, /^permissions: \{\}$/m, name);
    assert.doesNotMatch(text, /pull_request_target/, name);
  }
});

test("image web.fetch : construite seulement depuis main, publiée sur GHCR, avec la révision du commit", () => {
  const { text } = workflows.find((w) => w.name === "image-web-fetch.yml");
  assert.match(text, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(text, /branches: \[main\]/);
  assert.match(text, /IMAGE: ghcr\.io\/testeuribrahim-cloud\/ducaios-tools-web-fetch/);
  assert.match(text, /org\.opencontainers\.image\.revision=\$\{\{ github\.sha \}\}/);
  assert.match(text, /persist-credentials: false/);
});
