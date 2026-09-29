// Extraction du texte, identique à web_fetch d'OpenClaw en mode "text" : code de third_party/, sans modification.
import { createReadabilityWebContentExtractor } from "../../../third_party/openclaw/extensions/web-readability/web-content-extractor.js";
import { extractBasicHtmlContent, markdownToText, truncateWebFetchText } from "../../../third_party/openclaw/src/agents/tools/web-fetch-utils.js";
import { WebFetchError } from "./errors.js";

/** Types de contenu acceptés ; les autres sont refusés avant de lire le corps. */
export const ACCEPTED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "text/markdown", "application/json"] as const;
export type AcceptedContentType = (typeof ACCEPTED_CONTENT_TYPES)[number];

/** Type de contenu sans paramètres, en minuscules, s'il est accepté. */
export function acceptedContentType(header: string | undefined): AcceptedContentType | undefined {
  const type = (header ?? "").split(";")[0]!.trim().toLowerCase();
  return (ACCEPTED_CONTENT_TYPES as readonly string[]).includes(type) ? (type as AcceptedContentType) : undefined;
}

const readability = createReadabilityWebContentExtractor();

export interface Extracted {
  readonly text: string;
  readonly title?: string;
  readonly truncated: boolean;
}

export async function extractText(body: string, contentType: AcceptedContentType, url: string, maxChars: number): Promise<Extracted> {
  let text: string;
  let title: string | undefined;
  switch (contentType) {
    case "text/html":
    case "application/xhtml+xml": {
      const extracted =
        (await readability.extract({ html: body, url, extractMode: "text" })) ??
        (await extractBasicHtmlContent({ html: body, extractMode: "text" }));
      if (!extracted) throw new WebFetchError("extraction_failed", "aucun texte lisible dans la page");
      text = extracted.text;
      title = extracted.title;
      break;
    }
    case "text/markdown":
      text = markdownToText(body);
      break;
    case "application/json":
      try {
        text = JSON.stringify(JSON.parse(body), null, 2);
      } catch {
        text = body;
      }
      break;
    case "text/plain":
      text = body;
      break;
  }
  const truncated = truncateWebFetchText(text, maxChars);
  return { text: truncated.text, ...(title ? { title } : {}), truncated: truncated.truncated };
}
