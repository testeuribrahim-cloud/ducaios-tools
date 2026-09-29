// Banc d'essai de web.fetch : serveur https local (certificat généré), faux résolveur, connexion injectée.
// Le code de production ne voit jamais l'adresse de bouclage : il vérifie l'adresse publique que rend le
// faux résolveur et la fige dans le lookup de la connexion ; seule la connexion injectée du test
// redirige ensuite vers 127.0.0.1 et le port du serveur local, en gardant la vérification TLS du nom.
import { createServer, request, type RequestOptions } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchPage, type FetchDeps, type ResolvedAddress, type WebFetchOutput } from "../../src/fetch-page.js";
import { WebFetchError } from "../../src/errors.js";
import { selfSignedCertificate } from "./certificate.js";

/** Domaine des pages d'essai ; le certificat couvre « exemple.test » et « *.exemple.test ». */
export const DOMAIN = "exemple.test";
/** Adresse publique (documentée comme telle) que rend le faux résolveur par défaut. */
export const PUBLIC_IP = "93.184.215.14";

const certificate = selfSignedCertificate([DOMAIN, `*.${DOMAIN}`]);

export type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export interface Received {
  readonly host: string;
  readonly path: string;
}

export interface TestServer {
  readonly port: number;
  /** Requêtes reçues, dans l'ordre (hôte sans port, chemin). */
  readonly received: Received[];
  /** Page servie pour « https://<hôte><chemin> ». */
  route(host: string, path: string, handler: Handler): void;
  close(): Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const routes = new Map<string, Handler>();
  const received: Received[] = [];
  const server = createServer({ cert: certificate.cert, key: certificate.key }, (req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    received.push({ host, path: req.url ?? "" });
    const handler = routes.get(`${host}${req.url}`);
    if (handler) handler(req, res);
    else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("absent");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    received,
    route: (host, path, handler) => { routes.set(`${host}${path}`, handler); },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Ce que le code de production a demandé à la connexion. */
export interface Connection {
  readonly host: string | null | undefined;
  readonly servername: string | undefined;
  readonly port: RequestOptions["port"];
  readonly agent: RequestOptions["agent"];
  readonly rejectUnauthorized: boolean | undefined;
  /** Ce que rend le lookup figé par la production, interrogé comme le fait node:net. */
  readonly pinned: readonly ResolvedAddress[];
}

export interface Bench {
  readonly deps: FetchDeps;
  /** Appels du résolveur, par nom. */
  readonly lookups: string[];
  readonly connections: Connection[];
}

/**
 * Résolveur : `addresses[nom]` est une liste, ou une fonction du numéro d'appel pour ce nom
 * (DNS rebinding). Nom inconnu : PUBLIC_IP. Connexion : vers le serveur local, CA de l'essai.
 */
export function bench(server: TestServer | undefined, addresses: Record<string, readonly string[] | ((call: number) => readonly string[])> = {}): Bench {
  const lookups: string[] = [];
  const connections: Connection[] = [];
  const deps: FetchDeps = {
    lookup: async (hostname) => {
      lookups.push(hostname);
      const entry = addresses[hostname];
      const list = typeof entry === "function" ? entry(lookups.filter((h) => h === hostname).length) : entry ?? [PUBLIC_IP];
      return list.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
    },
    connect: (options) => {
      let pinned: ResolvedAddress[] = [];
      (options.lookup as unknown as (h: string, o: object, cb: (e: unknown, a: ResolvedAddress[]) => void) => void)(
        String(options.host), { all: true }, (_error, list) => { pinned = list; },
      );
      connections.push({
        host: options.host, servername: options.servername, port: options.port, agent: options.agent,
        rejectUnauthorized: options.rejectUnauthorized, pinned,
      });
      if (!server) throw new Error("aucun serveur d'essai : la connexion n'aurait pas dû partir");
      return request({
        ...options,
        port: server.port,
        ca: [certificate.cert],
        lookup: ((_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          (o?.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4))) as unknown as RequestOptions["lookup"],
      });
    },
  };
  return { deps, lookups, connections };
}

export type Outcome =
  | { readonly ok: true; readonly value: WebFetchOutput; readonly ms: number }
  | { readonly ok: false; readonly code: string; readonly message: string; readonly ms: number };

/** fetchPage avec le banc donné ; une erreur attendue devient { ok: false, code, message }. */
export async function attempt(input: unknown, b: Bench): Promise<Outcome> {
  const start = Date.now();
  try {
    const value = await fetchPage(input, b.deps);
    return { ok: true, value, ms: Date.now() - start };
  } catch (error) {
    if (!(error instanceof WebFetchError)) throw error;
    return { ok: false, code: error.code, message: error.message, ms: Date.now() - start };
  }
}

/** Réponse d'une page d'essai. */
export const page = (contentType: string, body: string | Buffer, headers: Record<string, string> = {}): Handler => (_req, res) => {
  res.writeHead(200, { "content-type": contentType, ...headers });
  res.end(body);
};

export const redirect = (location: string, status = 302): Handler => (_req, res) => {
  res.writeHead(status, { location });
  res.end();
};

export const url = (host: string, path = "/") => `https://${host}${path}`;
