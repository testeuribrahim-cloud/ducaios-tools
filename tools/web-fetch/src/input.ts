import { WebFetchError } from "./errors.js";

export const DEFAULT_MAX_CHARS = 20_000;
export const MIN_MAX_CHARS = 100;
export const MAX_MAX_CHARS = 20_000;
/** Une adresse plus longue n'est pas une page ordinaire. */
export const MAX_URL_CHARS = 8_192;

export interface WebFetchInput {
  readonly url: string;
  readonly maxChars: number;
}

const ALLOWED_KEYS = new Set(["url", "maxChars"]);

/** Contrat d'entrée : {"url": string, "maxChars"?: entier 100..20000} ; tout autre champ ou type est refusé. */
export function parseInput(value: unknown): WebFetchInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WebFetchError("invalid_input", "entrée invalide : un objet JSON est attendu");
  }
  const extra = Object.keys(value).filter((key) => !ALLOWED_KEYS.has(key));
  if (extra.length > 0) throw new WebFetchError("invalid_input", `entrée invalide : champ inconnu « ${extra[0]!.slice(0, 40)} »`);
  const { url, maxChars } = value as { url?: unknown; maxChars?: unknown };
  if (typeof url !== "string" || url.trim() === "") throw new WebFetchError("invalid_input", "entrée invalide : « url » (texte) est obligatoire");
  if (url.length > MAX_URL_CHARS) throw new WebFetchError("invalid_input", "entrée invalide : « url » trop longue");
  if (maxChars !== undefined && (typeof maxChars !== "number" || !Number.isInteger(maxChars) || maxChars < MIN_MAX_CHARS || maxChars > MAX_MAX_CHARS)) {
    throw new WebFetchError("invalid_input", `entrée invalide : « maxChars » doit être un entier de ${MIN_MAX_CHARS} à ${MAX_MAX_CHARS}`);
  }
  return { url, maxChars: maxChars ?? DEFAULT_MAX_CHARS };
}
