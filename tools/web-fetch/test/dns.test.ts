// Résolution : toutes les adresses sont vérifiées, la connexion part vers l'adresse vérifiée, jamais de seconde résolution.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { attempt, bench, DOMAIN, page, PUBLIC_IP, redirect, startServer, url, type TestServer } from "./support/harness.js";

let server: TestServer;
before(async () => { server = await startServer(); });
after(() => server.close());

test("DNS rebinding : public au 1er appel puis 10.0.0.1 → une seule résolution, connexion vers l'adresse vérifiée", async () => {
  const name = `rebind.${DOMAIN}`;
  server.route(name, "/", page("text/plain", "page publique"));
  const b = bench(server, { [name]: (call) => (call === 1 ? [PUBLIC_IP] : ["10.0.0.1"]) });
  const r = await attempt({ url: url(name) }, b);
  assert.equal(r.ok, true);
  assert.deepEqual(b.lookups, [name], "le résolveur n'est appelé qu'une fois");
  assert.equal(b.connections.length, 1);
  assert.deepEqual(b.connections[0]!.pinned, [{ address: PUBLIC_IP, family: 4 }], "la connexion reçoit l'adresse vérifiée, pas 10.0.0.1");
});

test("DNS rebinding sur une redirection vers le même nom : une résolution par saut, chacune vérifiée", async () => {
  const name = `rebind2.${DOMAIN}`;
  server.route(name, "/a", redirect("/b"));
  server.route(name, "/b", page("text/plain", "ne doit pas être lu"));
  const b = bench(server, { [name]: (call) => (call === 1 ? [PUBLIC_IP] : ["10.0.0.1"]) });
  const r = await attempt({ url: url(name, "/a") }, b);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "non_public_address", "le 2e saut revoit la résolution et refuse 10.0.0.1");
  assert.deepEqual(b.lookups, [name, name]);
  assert.equal(b.connections.length, 1);
  assert.ok(!server.received.some((q) => q.host === name && q.path === "/b"));
});

test("nom qui résout vers une adresse publique ET une privée (dans un sens ou dans l'autre) → refus, aucune connexion", async () => {
  for (const addresses of [[PUBLIC_IP, "10.0.0.1"], ["192.168.1.10", PUBLIC_IP], [PUBLIC_IP, "2606:4700::1", "::1"], ["2606:4700::1", "fd00::5"]]) {
    const name = `mixte.${DOMAIN}`;
    const b = bench(server, { [name]: addresses });
    const r = await attempt({ url: url(name) }, b);
    assert.equal(r.ok, false, addresses.join(", "));
    if (r.ok) continue;
    assert.equal(r.code, "non_public_address");
    assert.match(r.message, /non publique/);
    assert.equal(b.connections.length, 0, addresses.join(", "));
  }
});

test("plusieurs adresses publiques : la connexion vise la première, et seulement elle", async () => {
  const name = `multi.${DOMAIN}`;
  server.route(name, "/", page("text/plain", "ok"));
  const b = bench(server, { [name]: ["2606:4700::6810:84e5", PUBLIC_IP] });
  const r = await attempt({ url: url(name) }, b);
  assert.equal(r.ok, true);
  assert.deepEqual(b.connections[0]!.pinned, [{ address: "2606:4700::6810:84e5", family: 6 }]);
});

test("nom sans adresse ou introuvable : erreur de résolution, aucune connexion", async () => {
  const vide = bench(server, { [`vide.${DOMAIN}`]: [] });
  const r1 = await attempt({ url: url(`vide.${DOMAIN}`) }, vide);
  assert.equal(r1.ok, false);
  if (!r1.ok) assert.equal(r1.code, "dns_error");
  assert.equal(vide.connections.length, 0);

  const introuvable = bench(server);
  const failing = { ...introuvable.deps, lookup: async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); } };
  const r2 = await attempt({ url: url(`absent.${DOMAIN}`) }, { ...introuvable, deps: failing });
  assert.equal(r2.ok, false);
  if (!r2.ok) assert.equal(r2.code, "dns_error");
  assert.equal(introuvable.connections.length, 0);
});
