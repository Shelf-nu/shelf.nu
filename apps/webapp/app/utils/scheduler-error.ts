/**
 * Scheduler error causes
 *
 * pg-boss re-emits pool and worker failures as `error` events, and the objects
 * it hands over carry far more than the failure: pg-pool attaches the whole
 * idle `client` to a connection error, including its connection parameters
 * (database user, pooler host, settings). The Sentry overlay serializes a
 * ShelfError's cause in full, so those objects must be reduced before they are
 * wrapped and logged. The connection's own user and host can also appear in an
 * error's text (an authentication or DNS failure names them), so the kept
 * message and stack have those values replaced.
 *
 * @see {@link file://./scheduler.server.ts} the pg-boss `error` handler
 * @see {@link file://../../server/instrument.server.ts} cause serialization
 */

/** Fields of a pg or pg-boss failure that describe it without exposing config */
const KEPT_FIELDS = ["code", "errno", "syscall", "queue", "worker"] as const;

/** Nested causes are reduced too, up to this depth */
const MAX_DEPTH = 3;

/** What replaces a connection value found in an error's text */
const REDACTED = "[redacted]";

/**
 * Values from a Postgres connection string that must not appear in logged
 * error text: the user, the password and the host. Shorter than three
 * characters is skipped, since replacing it would mangle unrelated text.
 *
 * @param connectionString - A `postgres://user:password@host:port/db` URL
 * @returns The values to redact, longest first; empty if the URL is unreadable
 */
export function connectionSecretsFrom(connectionString: string): string[] {
  try {
    const url = new URL(connectionString);
    return [
      decodeURIComponent(url.username),
      decodeURIComponent(url.password),
      url.hostname,
    ]
      .filter((value) => value.length >= 3)
      .sort((a, b) => b.length - a.length);
  } catch {
    return [];
  }
}

/** Replaces every occurrence of each secret in `text` */
function scrub(text: string, secrets: readonly string[]): string {
  return secrets.reduce(
    (result, secret) => result.split(secret).join(REDACTED),
    text
  );
}

/**
 * Reduces a pg-boss `error` event payload to an `Error` holding only its name,
 * message, stack, the fields in {@link KEPT_FIELDS}, and the same reduction of
 * any nested `cause` or `errors` (AggregateError). Everything else, notably a
 * pg `client` and its connection parameters, is dropped, and each of `secrets`
 * is replaced in the message and stack.
 *
 * @param cause - The value pg-boss emitted: an Error, or a plain object spread
 *   from one (worker errors arrive as `{ ...error, message, stack, queue }`)
 * @param secrets - Connection values to redact from the text, as returned by
 *   {@link connectionSecretsFrom}
 * @param depth - Nesting level of this cause; callers omit it
 * @returns A safe-to-log Error, or the input unchanged when it is not an object
 */
export function toSchedulerErrorCause(
  cause: unknown,
  secrets: readonly string[] = [],
  depth = 0
): unknown {
  if (!cause || typeof cause !== "object") {
    return cause;
  }

  const source = cause as Record<string, unknown>;
  const safe = new Error(
    typeof source.message === "string"
      ? scrub(source.message, secrets)
      : "pg-boss error"
  );
  if (typeof source.name === "string") safe.name = source.name;
  if (typeof source.stack === "string") {
    safe.stack = scrub(source.stack, secrets);
  }

  const kept: Record<string, unknown> = {};
  for (const field of KEPT_FIELDS) {
    const value = source[field];
    if (typeof value === "string" || typeof value === "number") {
      kept[field] = value;
    }
  }
  if (depth < MAX_DEPTH) {
    if (source.cause) {
      kept.cause = toSchedulerErrorCause(source.cause, secrets, depth + 1);
    }
    if (Array.isArray(source.errors)) {
      kept.errors = source.errors.map((error) =>
        toSchedulerErrorCause(error, secrets, depth + 1)
      );
    }
  }

  return Object.assign(safe, kept);
}
