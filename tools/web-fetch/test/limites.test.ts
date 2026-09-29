// Limites : 2 000 000 octets comptés après décompression, 9 s pour tout l'appel, types de contenu acceptés.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { MAX_BODY_BYTES, TOTAL_TIMEOUT_MS } from "../src/fetch-page.js";
import { attempt, bench, DOMAIN, page, redirect, startServer, url, type TestServer } from "./support/harness.js";

let server: TestServer;
before(async () => { server = await startServer(); });
after(() => server.close());

const host = (label: string) => `${label}.${DOMAIN}`;

test("limites annoncées par le contrat", () => {
  assert.equal(MAX_BODY_BYTES, 2_000_000);
  assert.equal(TOTAL_TIMEOUT_MS, 9_000);
});

test("corps de 2 000 000 octets : accepté, « bytes » exact ; 2 000 001 octets : refusé (annoncé ou non)", async () => {
  server.route(host("juste"), "/", page("text/plain", Buffer.alloc(2_000_000, "a")));
  const ok = await attempt({ url: url(host("juste")), maxChars: 100 }, bench(server));
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.value.bytes, 2_000_000);
    assert.equal(ok.value.truncated, true);
    assert.equal(ok.value.text.length, 100);
  }

  server.route(host("trop"), "/", page("text/plain", Buffer.alloc(2_000_001, "a")));
  const annonce = await attempt({ url: url(host("trop")) }, bench(server));
  assert.equal(annonce.ok, false);
  if (!annonce.ok) assert.equal(annonce.code, "body_too_large");

  // Sans content-length (envoi par morceaux) : compté en continu.
  server.route(host("morceaux"), "/", (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    for (let i = 0; i < 20; i++) res.write(Buffer.alloc(100_000, "b"));
    res.end(Buffer.alloc(1, "b"));
  });
  const morceaux = await attempt({ url: url(host("morceaux")) }, bench(server));
  assert.equal(morceaux.ok, false);
  if (!morceaux.ok) assert.equal(morceaux.code, "body_too_large");
});

test("archives piégées (gzip, deflate, br) qui se décompressent au-delà de 2 Mo : refusées", async () => {
  const bomb = Buffer.alloc(50_000_000);
  for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]] as const) {
    const packed = compress(bomb);
    assert.ok(packed.length < 100_000, `${encoding} : ${packed.length} octets compressés`);
    server.route(host(`bombe-${encoding}`), "/", page("text/plain", packed, { "content-encoding": encoding }));
    const r = await attempt({ url: url(host(`bombe-${encoding}`)) }, bench(server));
    assert.equal(r.ok, false, encoding);
    if (!r.ok) assert.equal(r.code, "body_too_large", encoding);
  }
});

test("gzip, deflate et br ordinaires : décompressés, « bytes » compte les octets après décompression", async () => {
  const text = "Du texte compressé, répété. ".repeat(500);
  for (const [encoding, compress] of [["gzip", gzipSync], ["deflate", deflateSync], ["br", brotliCompressSync]] as const) {
    server.route(host(`zip-${encoding}`), "/", page("text/plain; charset=utf-8", compress(Buffer.from(text)), { "content-encoding": encoding }));
    const r = await attempt({ url: url(host(`zip-${encoding}`)) }, bench(server));
    assert.equal(r.ok, true, encoding);
    if (r.ok) {
      assert.equal(r.value.text, text);
      assert.equal(r.value.bytes, Buffer.byteLength(text));
    }
  }
  server.route(host("zip-inconnu"), "/", page("text/plain", "x", { "content-encoding": "zstd" }));
  const inconnu = await attempt({ url: url(host("zip-inconnu")) }, bench(server));
  assert.equal(inconnu.ok, false);
  if (!inconnu.ok) assert.equal(inconnu.code, "unsupported_encoding");

  server.route(host("zip-casse"), "/", page("text/plain", Buffer.from("pas du gzip"), { "content-encoding": "gzip" }));
  const casse = await attempt({ url: url(host("zip-casse")) }, bench(server));
  assert.equal(casse.ok, false);
  if (!casse.ok) assert.equal(casse.code, "network_error");
});

test("types de contenu : les cinq acceptés (paramètres et casse ignorés), les autres refusés", async () => {
  for (const type of ["text/html; charset=utf-8", "application/xhtml+xml", "text/plain", "text/markdown", "Application/JSON"]) {
    server.route(host("type-ok"), "/", page(type, type.includes("json") ? "{}" : "<p>bonjour</p>"));
    const r = await attempt({ url: url(host("type-ok")) }, bench(server));
    assert.equal(r.ok, true, type);
    if (r.ok) assert.equal(r.value.contentType, type.split(";")[0]!.toLowerCase());
  }
  for (const type of ["image/png", "application/pdf", "application/octet-stream", "text/javascript", "application/xml", "text/htmlx"]) {
    server.route(host("type-refuse"), "/", page(type, "x"));
    const r = await attempt({ url: url(host("type-refuse")) }, bench(server));
    assert.equal(r.ok, false, type);
    if (!r.ok) assert.equal(r.code, "unsupported_content_type", type);
  }
  server.route(host("type-absent"), "/", (_req, res) => { res.writeHead(200); res.end("x"); });
  const absent = await attempt({ url: url(host("type-absent")) }, bench(server));
  assert.equal(absent.ok, false);
  if (!absent.ok) assert.equal(absent.code, "unsupported_content_type");
});

test("réponse non 2xx : erreur « http_status »", async () => {
  for (const status of [304, 404, 500]) {
    server.route(host("statut"), "/", (_req, res) => { res.writeHead(status, { "content-type": "text/plain" }); res.end("x"); });
    const r = await attempt({ url: url(host("statut")) }, bench(server));
    assert.equal(r.ok, false, String(status));
    if (!r.ok) assert.equal(r.code, "http_status", String(status));
  }
});

test("serveur qui ne répond pas : refus au bout de 9 s au plus", async () => {
  server.route(host("muet"), "/", () => { /* ne répond jamais */ });
  const r = await attempt({ url: url(host("muet")) }, bench(server));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "timeout");
  assert.ok(r.ms >= TOTAL_TIMEOUT_MS - 100 && r.ms < TOTAL_TIMEOUT_MS + 1_000, `${r.ms} ms`);
});

test("les 9 s couvrent tout l'appel, redirections comprises", async () => {
  // Chaque saut répond en 2,5 s : aucun ne dépasse seul, les 3 redirections et la page dépassent ensemble.
  const slow = (handler: Parameters<TestServer["route"]>[2]): Parameters<TestServer["route"]>[2] => (req, res) => { setTimeout(() => handler(req, res), 2_500); };
  server.route(host("lent0"), "/", slow(redirect(url(host("lent1")))));
  server.route(host("lent1"), "/", slow(redirect(url(host("lent2")))));
  server.route(host("lent2"), "/", slow(redirect(url(host("lent3")))));
  server.route(host("lent3"), "/", slow(page("text/plain", "trop tard")));
  const r = await attempt({ url: url(host("lent0")) }, bench(server));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "timeout");
  assert.ok(r.ms < TOTAL_TIMEOUT_MS + 1_000, `${r.ms} ms`);
});
