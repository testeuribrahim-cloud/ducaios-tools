import { WebFetchError } from "./errors.js";
import type { FetchDeps } from "./fetch-page.js";
import { fetchPage } from "./fetch-page.js";

/** Une demande plus longue n'est pas une demande de web.fetch. */
export const MAX_STDIN_BYTES = 65_536;

interface Output {
  write(text: string): unknown;
}

/**
 * Lit la demande JSON, appelle fetchPage, écrit un seul objet JSON sur la sortie standard.
 * Rend le code de sortie : 0, ou 1 avec {"error": {"code", "message"}, "untrusted": true}
 * et un message court sur la sortie d'erreur.
 */
export async function run(stdin: AsyncIterable<Buffer | string>, stdout: Output, stderr: Output, deps: FetchDeps): Promise<number> {
  try {
    const result = await fetchPage(parseRequest(await readAll(stdin)), deps);
    stdout.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    const failure = error instanceof WebFetchError ? error : new WebFetchError("network_error", "erreur inattendue");
    stdout.write(`${JSON.stringify({ error: { code: failure.code, message: failure.message }, untrusted: true })}\n`);
    stderr.write(`web.fetch : ${failure.message}\n`);
    return 1;
  }
}

async function readAll(stdin: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > MAX_STDIN_BYTES) throw new WebFetchError("invalid_input", "entrée invalide : demande trop longue");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequest(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new WebFetchError("invalid_input", "entrée invalide : JSON illisible");
  }
}
