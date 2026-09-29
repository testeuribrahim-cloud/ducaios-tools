// Redirections suivies à la main : 3 au plus, chaque saut revérifié en entier avant toute connexion.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { attempt, bench, DOMAIN, page, redirect, startServer, url, type TestServer } from "./support/harness.js";

let server: TestServer;
before(async () => { server = await startServer(); });
after(() => server.close());

const host = (label: string) => `${label}.${DOMAIN}`;
const receivedBy = (name: string) => server.received.filter((r) => r.host === name);

test("3 redirections : succès, « redirects »: 3, « finalUrl » de la dernière page, une résolution par saut", async () => {
  server.route(host("r0"), "/depart", redirect(url(host("r1"), "/un"), 301));
  server.route(host("r1"), "/un", redirect("/deux", 302)); // relative : même hôte
  server.route(host("r1"), "/deux", redirect(url(host("fin"), "/page?x=1"), 308));
  server.route(host("fin"), "/page?x=1", page("text/plain; charset=utf-8", "arrivée"));
  const b = bench(server);
  const r = await attempt({ url: url(host("r0"), "/depart") }, b);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.redirects, 3);
  assert.equal(r.value.url, url(host("r0"), "/depart"));
  assert.equal(r.value.finalUrl, url(host("fin"), "/page?x=1"));
  assert.equal(r.value.text, "arrivée");
  assert.deepEqual(b.lookups, [host("r0"), host("r1"), host("r1"), host("fin")], "une résolution par saut, même vers le même hôte");
  assert.equal(b.connections.length, 4);
});

test("4e redirection : refus « interdit », la cible n'est jamais contactée", async () => {
  server.route(host("q0"), "/", redirect(url(host("q1"))));
  server.route(host("q1"), "/", redirect(url(host("q2"))));
  server.route(host("q2"), "/", redirect(url(host("q3"))));
  server.route(host("q3"), "/", redirect(url(host("q4-cible"))));
  server.route(host("q4-cible"), "/", page("text/plain", "ne doit pas être lu"));
  const b = bench(server);
  const r = await attempt({ url: url(host("q0")) }, b);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "too_many_redirects");
  assert.match(r.message, /interdit/);
  assert.equal(b.connections.length, 4, "départ et 3 redirections");
  assert.equal(receivedBy(host("q4-cible")).length, 0, "la cible de la 4e redirection ne reçoit rien");
  assert.ok(!b.lookups.includes(host("q4-cible")), "ni même une résolution");
});

test("redirection vers 127.0.0.1, 169.254.169.254, [::1] ou une écriture détournée : refus « non publique » avant toute connexion", async () => {
  for (const target of ["https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://0x7f.1/", "https://2130706433/", "https://[::ffff:127.0.0.1]/"]) {
    server.route(host("vers-prive"), "/", redirect(target));
    const b = bench(server);
    const r = await attempt({ url: url(host("vers-prive")) }, b);
    assert.equal(r.ok, false, target);
    if (r.ok) continue;
    assert.equal(r.code, "non_public_address", target);
    assert.match(r.message, /non publique/);
    assert.equal(b.connections.length, 1, `${target} : seule la première page est contactée`);
  }
});

test("redirection vers un nom qui mène à une adresse privée : refus, la cible ne reçoit rien", async () => {
  server.route(host("vers-nom-prive"), "/", redirect(url(host("interne"))));
  server.route(host("interne"), "/", page("text/plain", "secret interne"));
  const b = bench(server, { [host("interne")]: ["10.0.0.7"] });
  const r = await attempt({ url: url(host("vers-nom-prive")) }, b);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "non_public_address");
  assert.equal(b.connections.length, 1);
  assert.equal(receivedBy(host("interne")).length, 0);
});

test("redirection de https vers http : refus « interdit », la cible ne reçoit rien", async () => {
  server.route(host("vers-http"), "/", redirect(`http://${host("clair")}/`));
  server.route(host("clair"), "/", page("text/plain", "ne doit pas être lu"));
  const b = bench(server);
  const r = await attempt({ url: url(host("vers-http")) }, b);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.code, "forbidden_url");
  assert.match(r.message, /interdit/);
  assert.equal(b.connections.length, 1);
  assert.equal(receivedBy(host("clair")).length, 0);
});

test("redirection vers un autre port, file: ou des identifiants : refus « interdit »", async () => {
  for (const target of [`https://${host("x")}:8443/`, "file:///etc/passwd", `https://moi:secret@${host("x")}/`]) {
    server.route(host("vers-autre"), "/", redirect(target));
    const b = bench(server);
    const r = await attempt({ url: url(host("vers-autre")) }, b);
    assert.equal(r.ok, false, target);
    if (r.ok) continue;
    assert.equal(r.code, "forbidden_url", target);
    assert.match(r.message, /interdit/);
    assert.equal(b.connections.length, 1, target);
  }
});
