/**
 * Email payload redaction
 *
 * Emails carry live credentials inside their body: an invite links to
 * `/accept-invite/<id>?token=<jwt>`, and that link alone accepts the invite.
 * When a send fails, the payload is logged and reaches Sentry, where the
 * logger's key-based redaction cannot see a token that sits in the middle of
 * the `html` and `text` strings. This strips it before the payload is logged.
 *
 * @see {@link file://./mail.server.ts}
 * @see {@link file://./email.worker.server.ts}
 * @see {@link file://./../utils/redact.ts} the key-based redaction it adds to
 */
import { REDACTED_URL_PART } from "~/utils/redact";
import type { EmailPayloadType } from "./types";

/** A `token` query parameter's value, in a plain or HTML-escaped URL. */
const TOKEN_QUERY_PARAM = /([?&](?:amp;)?token=)[^&\s"'<>]+/gi;

/** A JSON Web Token anywhere in the text: three base64url segments. */
const JSON_WEB_TOKEN = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;

/**
 * Replaces every token in an email body with a placeholder.
 *
 * @param value - An email's text or HTML body
 * @returns The body with token values replaced
 */
export function redactEmailTokens(value: string): string {
  return value
    .replace(TOKEN_QUERY_PARAM, `$1${REDACTED_URL_PART}`)
    .replace(JSON_WEB_TOKEN, REDACTED_URL_PART);
}

/**
 * A copy of an email payload that is safe to log: the body keeps its wording,
 * so a failed send can still be told apart, but carries no token.
 *
 * @param payload - The email as it was queued or sent
 * @returns The payload with tokens stripped from `text` and `html`
 */
export function redactEmailPayloadForLog(
  payload: EmailPayloadType
): EmailPayloadType {
  return {
    ...payload,
    text: redactEmailTokens(payload.text),
    ...(payload.html !== undefined && {
      html: redactEmailTokens(payload.html),
    }),
  };
}
