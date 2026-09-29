// Certificat auto-signé généré pendant le test, avec node:crypto seul (aucun fichier, aucun secret gardé) :
// clé EC P-256, X.509 v3 encodé à la main (DER), noms dans subjectAltName.
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

const length = (n: number) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, ...content: Buffer[]) => {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
};
const seq = (...c: Buffer[]) => tlv(0x30, ...c);
const oid = (dotted: string) => {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const chunk: number[] = [];
    let v = n;
    do { chunk.unshift(v & 0x7f); v = Math.floor(v / 128); } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i++) chunk[i]! |= 0x80;
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const utcTime = (d: Date) => tlv(0x17, Buffer.from(`${d.toISOString().slice(2, 19).replace(/[-:T]/g, "")}Z`));
const pem = (label: string, der: Buffer) => `-----BEGIN ${label}-----\n${der.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END ${label}-----\n`;

export interface TestCertificate {
  readonly cert: string;
  readonly key: string;
}

/** Certificat valable hier à demain pour les noms donnés (jokers « *.domaine » compris). */
export function selfSignedCertificate(names: readonly string[]): TestCertificate {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const name = seq(tlv(0x31, seq(oid("2.5.4.3"), tlv(0x0c, Buffer.from("ducaios web.fetch test")))));
  const serial = randomBytes(16);
  serial[0]! &= 0x7f;
  const now = Date.now();
  const san = seq(oid("2.5.29.17"), tlv(0x04, seq(...names.map((n) => tlv(0x82, Buffer.from(n))))));
  const basicConstraints = seq(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, seq(tlv(0x01, Buffer.from([0xff])))));
  const tbs = seq(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, serial),
    ecdsaSha256,
    name,
    seq(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 86_400_000))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, seq(basicConstraints, san)),
  );
  const signature = sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const der = seq(tbs, ecdsaSha256, tlv(0x03, Buffer.from([0]), signature));
  return { cert: pem("CERTIFICATE", der), key: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
}
