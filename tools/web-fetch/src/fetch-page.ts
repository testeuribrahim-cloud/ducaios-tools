import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { checkUrl, isPublicAddress, type CheckedUrl } from "./address.js";
import { WebFetchError } from "./errors.js";
import { acceptedContentType, extractText } from "./extract.js";
import { parseInput } from "./input.js";

/** Octets de corps au plus, comptés en continu après décompression. */
export const MAX_BODY_BYTES = 2_000_000;
/** Durée maximale de tout l'appel, résolutions et redirections comprises. */
export const TOTAL_TIMEOUT_MS = 9_000;
/** Redirections suivies au plus : la suivante est refusée. */
export const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const USER_AGENT = "ducaios-web.fetch/1.0.0";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** Résolution d'un nom : toutes ses adresses (dns.lookup avec all: true). */
export type Lookup = (hostname: string) => Promise<readonly ResolvedAddress[]>;
/** Ouverture de la requête https (https.request). */
export type Connect = (options: RequestOptions) => ClientRequest;

/** Les deux seuls points d'injection, pour les tests ; le point d'entrée passe `realDeps`. */
export interface FetchDeps {
  readonly lookup: Lookup;
  readonly connect: Connect;
}

export const realDeps: FetchDeps = {
  lookup: (hostname) =>
    new Promise((resolve, reject) => {
      dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses: LookupAddress[]) => (error ? reject(error) : resolve(addresses)));
    }),
  connect: (options) => httpsRequest(options),
};

export interface WebFetchOutput {
  readonly url: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly title?: string;
  readonly text: string;
  readonly truncated: boolean;
  readonly bytes: number;
  readonly redirects: number;
  readonly untrusted: true;
}

/**
 * Lit une page https publique et rend son texte (contrat de web.fetch 1.0.0).
 * Chaque saut est vérifié en entier : adresse, résolution (une seule adresse non publique
 * refuse le nom), connexion à l'adresse vérifiée elle-même, sans seconde résolution.
 */
export async function fetchPage(rawInput: unknown, deps: FetchDeps): Promise<WebFetchOutput> {
  const input = parseInput(rawInput);
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new WebFetchError("timeout", `délai de ${TOTAL_TIMEOUT_MS / 1000} s dépassé`));
    }, TOTAL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([fetchWithin(input.url, input.maxChars, deps, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function fetchWithin(rawUrl: string, maxChars: number, deps: FetchDeps, signal: AbortSignal): Promise<WebFetchOutput> {
  let current = checkUrl(rawUrl);
  let redirects = 0;
  for (;;) {
    const address = await resolve(current, deps.lookup);
    const response = await send(current, address, deps.connect, signal);
    const status = response.statusCode ?? 0;
    const location = response.headers.location;

    if (REDIRECT_STATUSES.has(status) && location) {
      response.destroy();
      if (redirects >= MAX_REDIRECTS) throw new WebFetchError("too_many_redirects", `plus de ${MAX_REDIRECTS} redirections : interdit`);
      redirects += 1;
      let next: URL;
      try {
        next = new URL(location, current.url);
      } catch {
        throw new WebFetchError("network_error", "redirection vers une adresse invalide");
      }
      if (next.protocol === "http:") throw new WebFetchError("forbidden_url", "redirection de https vers http interdite");
      current = checkUrl(next.href);
      continue;
    }
    if (status < 200 || status > 299) {
      response.destroy();
      throw new WebFetchError("http_status", `réponse HTTP ${status}`);
    }
    const header = response.headers["content-type"];
    const contentType = acceptedContentType(header);
    if (!contentType) {
      response.destroy();
      throw new WebFetchError("unsupported_content_type", `type de contenu « ${(header ?? "absent").slice(0, 80)} » refusé`);
    }
    const body = await readBody(response);
    const text = decode(body, contentType === "application/json" ? undefined : header);
    const extracted = await extractText(text, contentType, current.url.href, maxChars);
    return {
      url: rawUrl,
      finalUrl: current.url.href,
      status,
      contentType,
      ...(extracted.title ? { title: extracted.title } : {}),
      text: extracted.text,
      truncated: extracted.truncated,
      bytes: body.length,
      redirects,
      untrusted: true,
    };
  }
}

/** Adresse de connexion vérifiée : l'IP littérale, ou la première de la résolution si TOUTES sont publiques. */
async function resolve(target: CheckedUrl, lookup: Lookup): Promise<ResolvedAddress> {
  if (target.ipFamily !== 0) return { address: target.host, family: target.ipFamily };
  let addresses: readonly ResolvedAddress[];
  try {
    addresses = await lookup(target.host);
  } catch {
    throw new WebFetchError("dns_error", `nom ${target.host.slice(0, 253)} introuvable`);
  }
  if (addresses.length === 0) throw new WebFetchError("dns_error", `nom ${target.host.slice(0, 253)} sans adresse`);
  const refused = addresses.find((a) => !isPublicAddress(a.address));
  if (refused) throw new WebFetchError("non_public_address", `le nom ${target.host.slice(0, 253)} mène à une adresse non publique (${refused.address})`);
  return addresses[0]!;
}

/**
 * Requête GET vers l'adresse vérifiée : le `lookup` de la connexion rend cette adresse et
 * rien d'autre (aucune seconde résolution) ; `servername` garde la vérification TLS du nom.
 */
function send(target: CheckedUrl, address: ResolvedAddress, connect: Connect, signal: AbortSignal): Promise<IncomingMessage> {
  const pinned = ((_hostname: string, options: unknown, callback?: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (...args: unknown[]) => void;
    const all = typeof options === "object" && options !== null && (options as { all?: boolean }).all === true;
    if (all) cb(null, [{ address: address.address, family: address.family }]);
    else cb(null, address.address, address.family);
  }) as unknown as RequestOptions["lookup"];

  return new Promise((resolvePromise, reject) => {
    let request: ClientRequest;
    try {
      request = connect({
        method: "GET",
        host: target.host,
        port: 443,
        path: `${target.url.pathname}${target.url.search}`,
        ...(target.ipFamily === 0 ? { servername: target.host } : {}),
        lookup: pinned,
        agent: false,
        signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/markdown,text/plain,application/json;q=0.9,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br",
        },
      });
    } catch {
      reject(new WebFetchError("network_error", "connexion impossible"));
      return;
    }
    request.once("response", resolvePromise);
    request.once("error", (error: NodeJS.ErrnoException) => {
      if (signal.aborted) reject(new WebFetchError("timeout", `délai de ${TOTAL_TIMEOUT_MS / 1000} s dépassé`));
      else reject(new WebFetchError("network_error", `connexion impossible${error.code ? ` (${error.code})` : ""}`));
    });
    request.end();
  });
}

/** Corps décompressé (gzip, deflate, br), compté en continu : une archive piégée s'arrête à la limite. */
async function readBody(response: IncomingMessage): Promise<Buffer> {
  const encoding = String(response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  let stream: Readable = response;
  if (encoding !== "identity" && encoding !== "") {
    const decoder =
      encoding === "gzip" || encoding === "x-gzip" ? createGunzip()
        : encoding === "deflate" ? createInflate()
          : encoding === "br" ? createBrotliDecompress()
            : undefined;
    if (!decoder) {
      response.destroy();
      throw new WebFetchError("unsupported_encoding", `encodage « ${encoding.slice(0, 40)} » refusé`);
    }
    response.once("error", (error) => decoder.destroy(error));
    stream = response.pipe(decoder);
  } else {
    const declared = Number(response.headers["content-length"]);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      response.destroy();
      throw new WebFetchError("body_too_large", `corps de plus de ${MAX_BODY_BYTES} octets`);
    }
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk as Buffer;
      total += buffer.length;
      if (total > MAX_BODY_BYTES) throw new WebFetchError("body_too_large", `corps de plus de ${MAX_BODY_BYTES} octets`);
      chunks.push(buffer);
    }
  } catch (error) {
    response.destroy();
    stream.destroy();
    if (error instanceof WebFetchError) throw error;
    throw new WebFetchError("network_error", encoding === "identity" ? "lecture du corps interrompue" : "corps compressé illisible");
  }
  return Buffer.concat(chunks);
}

/** Texte du corps : jeu de caractères de l'en-tête s'il est connu, sinon UTF-8. */
function decode(body: Buffer, header: string | undefined): string {
  const charset = /charset\s*=\s*"?([^";\s]+)/i.exec(header ?? "")?.[1];
  if (charset) {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      // Jeu de caractères inconnu : UTF-8.
    }
  }
  return new TextDecoder("utf-8").decode(body);
}
