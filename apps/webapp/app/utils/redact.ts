/**
 * Redaction for values that reach logs.
 *
 * `ShelfError.additionalData` is emitted by the pino logger and spread into
 * Sentry's `extra`, so anything placed there is written to durable storage in
 * plaintext. `shouldBeCaptured: false` only suppresses the Sentry hop — the log
 * line is still written.
 *
 * That matters most for `parseData`, which puts the ENTIRE submitted payload
 * into `additionalData` on a validation failure. On the password-reset form
 * that payload is `{ email, otp, password, confirmPassword }`, so the most
 * ordinary user mistake — mistyping the confirmation — logged a valid OTP and
 * the user's chosen password. No attacker required.
 *
 * Redaction is by KEY NAME rather than by value, because the sensitive thing is
 * identified by what the field is for, not by what it looks like.
 *
 * @see {@link file://./http.server.ts} `parseData`
 * @see {@link file://./error.ts} `ShelfError.additionalData`
 */

/**
 * Field names whose values must never be logged.
 *
 * Matched case-insensitively against the whole key, allowing a `camelCase`,
 * `snake_case`, `kebab-case` or dotted prefix/suffix around the sensitive word
 * — so `newPassword`, `password_confirmation` and `x-api-key` all match, while
 * a merely adjacent field like `passwordUpdatedAt` does not need to.
 */
const SENSITIVE_KEY =
  /(?:^|[._-]|(?<=[a-z0-9]))(otp|passwd|password|pwd|secret|token|api[._-]?key|credential|authorization|cookie|session[._-]?id|private[._-]?key)(?:$|[._-]|(?=[A-Z]))/i;

/** Replacement written in place of a redacted value. */
export const REDACTED = "[REDACTED]";

/**
 * Replacement for a credential embedded inside a URL.
 *
 * Distinct from {@link REDACTED} because it is written back through
 * `URL.toString()`, which percent-encodes the brackets and would turn the
 * marker into noise in the middle of an otherwise readable URL.
 */
export const REDACTED_URL_PART = "REDACTED";

/**
 * Replacement for a subtree deeper than {@link MAX_DEPTH}.
 *
 * Returning such a subtree unchanged would defeat the whole function: a
 * `password` nested five levels down would be written in plaintext. A redactor
 * has to fail closed, so the depth limit truncates rather than waves through.
 */
export const TRUNCATED = "[TRUNCATED]";

/** How deep to walk nested objects before giving up. */
const MAX_DEPTH = 4;

/**
 * Query parameters that carry a credential in a URL.
 *
 * {@link SENSITIVE_KEY} already covers the obvious names (`token`, `api_key`,
 * `secret`). These are the signed-URL specific ones it does not — and they are
 * exactly what an image URL from a private bucket carries.
 */
const SENSITIVE_URL_PARAM =
  /^(?:sig|signature|x-amz-signature|x-amz-credential|x-amz-security-token|access[._-]?token|auth)$/i;

/**
 * Removes credentials embedded in a URL string.
 *
 * A secret does not have to sit under a sensitive key to end up in a log line —
 * it can be inside the value, where key-based redaction cannot see it because
 * the key is just `url`.
 *
 * This is not hypothetical: asset CSV import accepts arbitrary image URLs and
 * `ssrf.server.ts` logs the URL on every failure path, so a row pointing at
 * `https://user:pass@host/img.jpg` or `https://host/img.jpg?token=...` wrote a
 * live credential to the platform logs (CWE-532).
 *
 * Both halves matter: basic-auth userinfo and signed-URL query parameters.
 *
 * Deliberately narrow — only strings that parse as http(s) URLs are touched, so
 * ordinary prose in an error message is never mangled.
 *
 * @param value - Any string bound for a log line
 * @returns The string with embedded credentials replaced, or unchanged
 */
export function redactUrlCredentials(value: string): string {
  // Cheap guard first: this runs over every string in every error payload.
  if (!/^https?:\/\//i.test(value)) {
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Unparseable, so there is no structure to reason about. Returning it
    // unchanged is safe: the guard above proved it is not a bare secret, and
    // guessing at delimiters would be worse than leaving it alone.
    return value;
  }

  if (url.username || url.password) {
    url.username = REDACTED_URL_PART;
    url.password = REDACTED_URL_PART;
  }

  for (const param of Array.from(url.searchParams.keys())) {
    if (SENSITIVE_KEY.test(param) || SENSITIVE_URL_PARAM.test(param)) {
      url.searchParams.set(param, REDACTED_URL_PART);
    }
  }

  return url.toString();
}

/**
 * Returns a copy of `value` with any sensitively-named field replaced by
 * {@link REDACTED}.
 *
 * Never mutates the input — the caller usually still needs the real values (a
 * validation failure still has to tell the user which field was wrong).
 *
 * Walks nested objects and arrays to a bounded depth so a payload shaped
 * `{ user: { password } }` is covered without risking a cycle or a pathological
 * structure. Anything deeper is replaced by {@link TRUNCATED} rather than
 * returned as-is — an unwalked subtree is an unredacted one, and losing some
 * debugging context is the right trade against writing a credential.
 *
 * @param value - Any value destined for `additionalData` or a log line
 * @param depth - Internal recursion counter; callers should omit it
 * @returns A redacted copy, or the original for primitives
 */
export function redactSensitive<T>(value: T, depth = 0): T {
  // Strings are inspected, not waved through: a secret does not have to sit
  // under a sensitive KEY to reach a log line — it can be inside the value.
  if (typeof value === "string") {
    return redactUrlCredentials(value) as unknown as T;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  // Past the limit we can no longer inspect what is in there, so we must not
  // pass it through.
  if (depth > MAX_DEPTH) {
    return TRUNCATED as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactSensitive(item, depth + 1)
    ) as unknown as T;
  }

  // Dates, FormData, and other non-plain objects are returned untouched rather
  // than being flattened into a plain object by the spread below.
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redactSensitive(item, depth + 1);
  }

  return result as T;
}
