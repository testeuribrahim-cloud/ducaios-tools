// Adresses refusées avant toute connexion : plages IPv4 et IPv6, écritures détournées, schémas, identifiants, ports.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { attempt, bench, DOMAIN, page, startServer, url, type TestServer } from "./support/harness.js";

let server: TestServer;
before(async () => { server = await startServer(); });
after(() => server.close());

/** Au moins une adresse par plage refusée, dont ses bornes quand elles comptent. */
const REFUSED_V4: Record<string, readonly string[]> = {
  "127.0.0.0/8": ["127.0.0.1", "127.255.255.254"],
  "10.0.0.0/8": ["10.0.0.1", "10.255.255.255"],
  "172.16.0.0/12": ["172.16.0.1", "172.31.255.255"],
  "192.168.0.0/16": ["192.168.0.1", "192.168.255.255"],
  "169.254.0.0/16": ["169.254.169.254", "169.254.0.1"],
  "100.64.0.0/10": ["100.64.0.1", "100.127.255.255"],
  "0.0.0.0/8": ["0.0.0.0", "0.255.255.255"],
  "192.0.0.0/24": ["192.0.0.1", "192.0.0.255"],
  "198.18.0.0/15": ["198.18.0.1", "198.19.255.255"],
  "224.0.0.0/4": ["224.0.0.1", "239.255.255.255"],
  "240.0.0.0/4": ["240.0.0.1", "255.255.255.255"],
};
const REFUSED_V6: Record<string, readonly string[]> = {
  "::1/128": ["::1"],
  "::/128": ["::"],
  "fc00::/7": ["fc00::1", "fdff:ffff::1"],
  "fe80::/10": ["fe80::1", "febf::1"],
  "::ffff:0:0/96": ["::ffff:127.0.0.1", "::ffff:8.8.8.8"],
  "64:ff9b::/96": ["64:ff9b::7f00:1"],
  "100::/64": ["100::1"],
  "2001:db8::/32": ["2001:db8::1"],
  "ff00::/8": ["ff02::1", "ff00::1"],
};
/** Juste à côté des plages : publiques, donc acceptées. */
const PUBLIC_NEIGHBOURS = ["172.32.0.1", "100.128.0.1", "192.0.1.1", "198.20.0.1", "8.8.8.8", "2606:4700::6810:1", "fec0::1", "100:0:0:1::1"];

const literal = (ip: string) => (ip.includes(":") ? `https://[${ip}]/` : `https://${ip}/`);

test("chaque plage refusée, en adresse littérale : refus « non publique » sans aucune connexion", async () => {
  for (const [range, ips] of Object.entries({ ...REFUSED_V4, ...REFUSED_V6 })) {
    for (const ip of ips) {
      const b = bench(server);
      const r = await attempt({ url: literal(ip) }, b);
      assert.equal(r.ok, false, `${range} : ${ip}`);
      if (r.ok) continue;
      assert.equal(r.code, "non_public_address", `${range} : ${ip}`);
      assert.match(r.message, /non publique/);
      assert.equal(b.connections.length, 0, `${range} : ${ip}`);
      assert.equal(b.lookups.length, 0, "une adresse littérale ne passe pas par le résolveur");
    }
  }
});

test("chaque plage refusée, derrière un nom : refus « non publique » sans aucune connexion", async () => {
  for (const [range, ips] of Object.entries({ ...REFUSED_V4, ...REFUSED_V6 })) {
    for (const ip of ips) {
      const name = `cible.${DOMAIN}`;
      const b = bench(server, { [name]: [ip] });
      const r = await attempt({ url: url(name) }, b);
      assert.equal(r.ok, false, `${range} : ${ip}`);
      if (r.ok) continue;
      assert.equal(r.code, "non_public_address");
      assert.match(r.message, /non publique/);
      assert.equal(b.connections.length, 0, `${range} : ${ip}`);
    }
  }
  assert.equal(server.received.length, 0, "le serveur n'a rien reçu");
});

test("écritures détournées de 127.0.0.1 : new URL() les ramène à l'adresse, refusée", async () => {
  for (const address of ["https://0x7f.1/", "https://2130706433/", "https://017700000001/", "https://0x7f000001/", "https://127.1/", "https://[::ffff:127.0.0.1]/", "https://[::ffff:7f00:1]/", "https://[0:0:0:0:0:0:0:1]/"]) {
    const b = bench(server);
    const r = await attempt({ url: address }, b);
    assert.equal(r.ok, false, address);
    if (r.ok) continue;
    assert.equal(r.code, "non_public_address", address);
    assert.match(r.message, /non publique/);
    assert.equal(b.connections.length, 0);
  }
});

test("adresses publiques voisines des plages : acceptées, et la connexion vise l'adresse vérifiée", async () => {
  const name = `voisin.${DOMAIN}`;
  server.route(name, "/", page("text/plain", "bonjour"));
  for (const ip of PUBLIC_NEIGHBOURS) {
    const b = bench(server, { [name]: [ip] });
    const r = await attempt({ url: url(name) }, b);
    assert.equal(r.ok, true, ip);
    assert.deepEqual(b.connections[0]?.pinned, [{ address: ip, family: ip.includes(":") ? 6 : 4 }], ip);
  }
});

test("https seulement : http:, file:, ftp:, data:, ws: et javascript: refusés, avec « interdit »", async () => {
  for (const address of [`http://${DOMAIN}/`, "file:///etc/passwd", `ftp://${DOMAIN}/`, "data:text/plain,bonjour", `ws://${DOMAIN}/`, "javascript:alert(1)"]) {
    const b = bench(server);
    const r = await attempt({ url: address }, b);
    assert.equal(r.ok, false, address);
    if (r.ok) continue;
    assert.equal(r.code, "forbidden_url", address);
    assert.match(r.message, /interdit/);
    assert.equal(b.lookups.length + b.connections.length, 0, address);
  }
});

test("identifiants dans l'adresse et port autre que 443 : refusés, avec « interdit » ; « :443 » accepté", async () => {
  for (const address of [`https://moi:secret@${DOMAIN}/`, `https://moi@${DOMAIN}/`, `https://${DOMAIN}:8443/`, `https://${DOMAIN}:80/`, `https://${DOMAIN}:1/`]) {
    const b = bench(server);
    const r = await attempt({ url: address }, b);
    assert.equal(r.ok, false, address);
    if (r.ok) continue;
    assert.equal(r.code, "forbidden_url", address);
    assert.match(r.message, /interdit/);
    assert.equal(b.lookups.length + b.connections.length, 0, address);
  }
  server.route(DOMAIN, "/443", page("text/plain", "port par défaut"));
  const b = bench(server);
  const r = await attempt({ url: `https://${DOMAIN}:443/443` }, b);
  assert.equal(r.ok, true);
  assert.equal(b.connections[0]?.port, 443);
});

test("connexion : port 443, servername = le nom, pas d'agent partagé, vérification TLS jamais désactivée", async () => {
  server.route(`tls.${DOMAIN}`, "/", page("text/plain", "ok"));
  const b = bench(server);
  const r = await attempt({ url: url(`tls.${DOMAIN}`) }, b);
  assert.equal(r.ok, true);
  const c = b.connections[0]!;
  assert.equal(c.port, 443);
  assert.equal(c.host, `tls.${DOMAIN}`);
  assert.equal(c.servername, `tls.${DOMAIN}`);
  assert.equal(c.agent, false);
  assert.notEqual(c.rejectUnauthorized, false);
});

test("certificat d'un autre nom : refusé par la vérification TLS normale", async () => {
  const name = "ailleurs.invalid";
  server.route(name, "/", page("text/plain", "ne doit pas être lu"));
  const b = bench(server);
  const r = await attempt({ url: url(name) }, b);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.code, "network_error");
    assert.match(r.message, /ERR_TLS_CERT_ALTNAME_INVALID/);
  }
});
