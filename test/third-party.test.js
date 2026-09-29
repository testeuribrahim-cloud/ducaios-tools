import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const BASE = "third_party/openclaw";
const provenance = JSON.parse(readFileSync(join(BASE, "PROVENANCE.json"), "utf8"));
/** Fichiers ajoutés par ce dépôt, hors copie. */
const OURS = ["PROVENANCE.json", "README.md"];

/** Empreinte Git d'un fichier (`git hash-object`). */
const gitBlob = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));

test("third_party/openclaw : chaque fichier copié garde sa taille, son empreinte Git et son SHA-256", () => {
  assert.ok(provenance.files.length > 0);
  for (const file of provenance.files) {
    const buf = readFileSync(join(BASE, file.path));
    assert.equal(buf.length, file.bytes, file.path);
    assert.equal(gitBlob(buf), file.gitBlob, file.path);
    assert.equal(createHash("sha256").update(buf).digest("hex"), file.sha256, file.path);
  }
});

test("third_party/openclaw : aucun fichier en plus ou en moins de la liste", () => {
  const present = walk(BASE).map((p) => relative(BASE, p)).sort();
  const expected = [...provenance.files.map((f) => f.path), ...OURS].sort();
  assert.deepEqual(present, expected);
});

test("third_party/openclaw : licence MIT et mention de copyright présentes, source épinglée", () => {
  const license = readFileSync(join(BASE, "LICENSE"), "utf8");
  assert.match(license, /^MIT License/);
  assert.ok(license.includes(provenance.source.copyright));
  assert.match(provenance.source.commit, /^[0-9a-f]{40}$/);
  assert.equal(provenance.source.tag, "v2026.9.6");
  for (const version of Object.values(provenance.libraries)) assert.match(version, /^\d+\.\d+\.\d+$/, "version exacte");
});
