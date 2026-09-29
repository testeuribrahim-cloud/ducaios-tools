/** Codes d'erreur de web.fetch, rendus dans {"error": {"code", "message"}}. */
export type WebFetchErrorCode =
  | "invalid_input"
  | "forbidden_url"
  | "non_public_address"
  | "dns_error"
  | "too_many_redirects"
  | "http_status"
  | "unsupported_content_type"
  | "unsupported_encoding"
  | "body_too_large"
  | "timeout"
  | "network_error"
  | "extraction_failed";

/**
 * Erreur attendue de l'outil : son message est court et sans détail interne.
 * Un refus de sécurité contient « non publique » ou « interdit ».
 */
export class WebFetchError extends Error {
  constructor(readonly code: WebFetchErrorCode, message: string) {
    super(message);
    this.name = "WebFetchError";
  }
}
