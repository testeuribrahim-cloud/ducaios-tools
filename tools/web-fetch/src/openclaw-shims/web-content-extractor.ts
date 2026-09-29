// Remplace « openclaw/plugin-sdk/web-content-extractor » : les fonctions viennent de third_party, sans modification.
export { htmlToMarkdown, normalizeWhitespace } from "../../../../third_party/openclaw/src/agents/tools/web-fetch-utils.js";
export { sanitizeHtml } from "../../../../third_party/openclaw/src/agents/tools/web-fetch-visibility.js";
export { stripInvisibleUnicode } from "../../../../third_party/openclaw/src/infra/unicode-visibility.js";

/** Demande d'extraction, telle que la reçoit l'extracteur Readability d'OpenClaw. */
export interface WebContentExtractionRequest {
  readonly html: string;
  readonly url: string;
  readonly extractMode: "markdown" | "text";
}

export interface WebContentExtractorPlugin {
  readonly id: string;
  readonly label: string;
  readonly autoDetectOrder: number;
  readonly extract: (request: WebContentExtractionRequest) => Promise<{ text: string; title?: string } | null>;
}
