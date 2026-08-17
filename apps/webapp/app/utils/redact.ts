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

/** How deep to walk nested objects before giving up. */
const MAX_DEPTH = 4;

/**
 * Returns a copy of `value` with any sensitively-named field replaced by
 * {@link REDACTED}.
 *
 * Never mutates the input — the caller usually still needs the real values (a
 * validation failure still has to tell the user which field was wrong).
 *
 * Walks nested objects and arrays to a bounded depth so a payload shaped
 * `{ user: { password } }` is covered without risking a cycle or a pathological
 * structure. Anything deeper is returned as-is; the alternative (dropping it)
 * would silently lose debugging context that is usually not sensitive.
 *
 * @param value - Any value destined for `additionalData` or a log line
 * @param depth - Internal recursion counter; callers should omit it
 * @returns A redacted copy, or the original for primitives
 */
export function redactSensitive<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== "object" || depth > MAX_DEPTH) {
    return value;
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
