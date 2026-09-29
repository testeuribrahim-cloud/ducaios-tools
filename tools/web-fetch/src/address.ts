import { BlockList, isIP } from "node:net";
import { WebFetchError } from "./errors.js";

/** Plages refusées (décision 0026 de DucAiOs) : jamais assouplies, ni par option ni par l'environnement. */
export const REFUSED_IPV4 = [
  "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10",
  "0.0.0.0/8", "192.0.0.0/24", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4",
] as const;
export const REFUSED_IPV6 = [
  "::1/128", "::/128", "fc00::/7", "fe80::/10", "::ffff:0:0/96", "64:ff9b::/96", "100::/64", "2001:db8::/32", "ff00::/8",
] as const;

/**
 * Une liste par famille : dans une même BlockList, node:net compare aussi une IPv4 aux règles
 * IPv6 sous sa forme ::ffff:a.b.c.d, que ::ffff:0:0/96 refuserait toujours.
 */
function blockList(ranges: readonly string[], type: "ipv4" | "ipv6"): BlockList {
  const list = new BlockList();
  for (const range of ranges) {
    const [network, prefix] = range.split("/");
    list.addSubnet(network!, Number(prefix), type);
  }
  return list;
}
const refusedV4 = blockList(REFUSED_IPV4, "ipv4");
const refusedV6 = blockList(REFUSED_IPV6, "ipv6");

/** Vrai si l'adresse IP (écriture de node:net) est publique ; toute adresse illisible est refusée. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !refusedV4.check(address, "ipv4");
  if (family === 6) return !refusedV6.check(address, "ipv6");
  return false;
}

export interface CheckedUrl {
  readonly url: URL;
  /** Nom à résoudre, ou adresse IP littérale (sans crochets) déjà vérifiée. */
  readonly host: string;
  /** 4 ou 6 si l'adresse est une IP littérale, 0 pour un nom. */
  readonly ipFamily: 0 | 4 | 6;
}

/**
 * Vérifie une adresse avant toute connexion : https seulement, port 443 seulement, aucun
 * identifiant, et une IP littérale doit être publique. L'analyse est celle de `new URL()`
 * (qui ramène 0x7f.1, 2130706433 ou 017700000001 à 127.0.0.1), puis de node:net.
 */
export function checkUrl(raw: string, base?: URL): CheckedUrl {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    throw new WebFetchError("invalid_input", "adresse invalide");
  }
  if (url.protocol !== "https:") throw new WebFetchError("forbidden_url", `schéma « ${url.protocol.slice(0, 20)} » interdit : https seulement`);
  if (url.username !== "" || url.password !== "") throw new WebFetchError("forbidden_url", "identifiants dans l'adresse interdits");
  // new URL() efface le port par défaut : « :443 » donne "", tout autre port reste.
  if (url.port !== "") throw new WebFetchError("forbidden_url", `port ${url.port} interdit : 443 seulement`);
  const host = url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
  if (host === "") throw new WebFetchError("invalid_input", "adresse invalide : aucun nom d'hôte");
  const ipFamily = isIP(host) as 0 | 4 | 6;
  if (ipFamily !== 0 && !isPublicAddress(host)) throw new WebFetchError("non_public_address", `adresse ${host} non publique`);
  return { url, host, ipFamily };
}
