import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const root = json("package.json");
const webFetch = json("tools/web-fetch/package.json");
const lock = json("package-lock.json");
const provenance = json("third_party/openclaw/PROVENANCE.json");
const EXACT = /^\d+\.\d+\.\d+$/;

test("dépendances : versions exactes partout (ni ^, ni ~, ni plage)", () => {
  for (const [where, deps] of [
    ["racine (développement)", root.devDependencies], ["racine (overrides)", root.overrides], ["web-fetch", webFetch.dependencies],
  ]) {
    for (const [name, version] of Object.entries(deps ?? {})) assert.match(version, EXACT, `${where} : ${name}@${version}`);
  }
  assert.equal(root.dependencies, undefined, "aucune dépendance d'exécution à la racine");
});

test("web-fetch : mêmes bibliothèques et mêmes versions qu'OpenClaw (PROVENANCE.json), verrouillées", () => {
  const { htmlparser2, ...direct } = provenance.libraries;
  assert.deepEqual(webFetch.dependencies, direct);
  assert.equal(root.overrides.htmlparser2, htmlparser2);
  for (const [name, version] of Object.entries(provenance.libraries)) {
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `package-lock : ${name}`);
  }
  assert.equal(lock.packages["tools/web-fetch"]?.version, webFetch.version);
  assert.match(webFetch.version, EXACT);
});
