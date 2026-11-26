/* eslint-disable no-console */
/**
 * Server-side Sentry init.
 *
 * Loaded first by `server/index.ts` (before any other module) so that the
 * @sentry/react-router auto-instrumentations (HTTP, Prisma, undici, etc.)
 * can patch their target modules before they are required.
 *
 * Errors, transactions and logs each have their own `beforeSend*` hook, and
 * every one of them masks email addresses before the payload leaves the
 * server (see `~/utils/sentry-email-mask`).
 */
import * as Sentry from "@sentry/react-router";
import { type Event, type EventHint } from "@sentry/react-router";

import { SENTRY_TRACES_SAMPLE_RATE } from "~/utils/constants";
import { SENTRY_DSN } from "~/utils/env";
import {
  isAbortError,
  isHandledClientError,
  isLikeShelfError,
} from "~/utils/error";
import { redactSensitive } from "~/utils/redact";
import { maskEmailsInSentryPayload } from "~/utils/sentry-email-mask";
import { withoutUnloggedHeaders } from "~/utils/unlogged-headers";

/**
 * Resolve the release identifier for this server process. Read from the
 * canonical SENTRY_RELEASE env var first, then fall back to Fly's
 * auto-injected FLY_RELEASE_VERSION so we get something even when the
 * deploy pipeline hasn't been updated to set SENTRY_RELEASE explicitly.
 */
function resolveRelease(): string | undefined {
  return (
    process.env.SENTRY_RELEASE || process.env.FLY_RELEASE_VERSION || undefined
  );
}

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    release: resolveRelease(),
    environment: process.env.NODE_ENV,
    // Structured Logs (separate from the error-event quota). Handled 4xx
    // client errors are emitted here as a low-severity trail instead of being
    // captured as errors — see Logger.handledClientError + handleBeforeSendError.
    enableLogs: true,
    integrations: [
      // Emit `span.op:db.sql.prisma` spans for every Prisma query. Requires
      // @prisma/instrumentation (already in the workspace) and Sentry.init
      // running before the Prisma client is imported — server/index.ts
      // imports this file first, so that ordering is preserved.
      Sentry.prismaIntegration(),
    ],
    // Shared with the client, so a sampled browser trace keeps its server half.
    tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
    beforeBreadcrumb(breadcrumb) {
      // Remove some noisy breadcrumbs
      if (
        breadcrumb.message?.startsWith("🚀") ||
        breadcrumb.message?.startsWith("🌍")
      ) {
        return null;
      }

      if (breadcrumb.message) {
        // Remove chalk colors that pollute the logs
        breadcrumb.message = breadcrumb.message.replace(
          // eslint-disable-next-line no-control-regex -- let me do my thing
          /(\x1B\[32m|\x1B\[0m)/gm,
          ""
        );
      }

      return breadcrumb;
    },
    /**
     * Performance transactions are kept, with credentials scrubbed from the
     * request (see {@link scrubEventRequest}) and email addresses masked. They
     * must NOT go through the error-event filter: a transaction carries no
     * exception, and that filter drops every event without one.
     */
    beforeSendTransaction: handleBeforeSendTransaction,
    beforeSend(event, hint) {
      const kept = handleBeforeSendError(event, hint);
      return kept && maskEmailsInSentryPayload(kept);
    },
    /** Structured logs quote `ShelfError` messages, which can name a user. */
    beforeSendLog(log) {
      return maskEmailsInSentryPayload(log);
    },
  });

  if (process.env.NODE_ENV === "production") {
    console.log("Sentry is enabled");
  }
}

/**
 * Hook for performance transactions: drops Prisma's bookkeeping spans (see
 * {@link dropPrismaBookkeepingSpans}), scrubs credentials from the request
 * (see {@link scrubEventRequest}) and masks email addresses.
 *
 * @param event - The transaction about to be sent
 * @returns The transaction to send
 */
export function handleBeforeSendTransaction<E extends Event>(event: E): E {
  dropPrismaBookkeepingSpans(event);
  scrubEventRequest(event);
  return maskEmailsInSentryPayload(event);
}

/** A span as it sits on a transaction event. */
type TransactionSpan = NonNullable<Event["spans"]>[number];

/**
 * `db` spans Prisma emits around every query that carry no query of ours: the
 * pooled connection checkout, and the `BEGIN` / `DEALLOCATE ALL` / `COMMIT`
 * wrapper it sends through PgBouncer. Matched exactly, so a real query that
 * merely contains one of these words is kept.
 */
const PRISMA_WRAPPER_DB_SPANS = new Set([
  "prisma:engine:connection",
  "BEGIN",
  "DEALLOCATE ALL",
  "COMMIT",
]);

/**
 * Whether a span is Prisma bookkeeping rather than a query worth seeing: its
 * client and engine phases (`prisma:client:*`, `prisma:engine:*`, op
 * `default`) and the wrapper statements in {@link PRISMA_WRAPPER_DB_SPANS}.
 * The `db` span holding the SQL that ran is never matched.
 *
 * @param span - A span from a transaction event
 */
function isPrismaBookkeepingSpan(span: TransactionSpan): boolean {
  const description = span.description ?? "";
  if (span.op === "default") return description.startsWith("prisma:");
  if (span.op === "db") return PRISMA_WRAPPER_DB_SPANS.has(description);
  return false;
}

/**
 * Removes Prisma's bookkeeping spans from a transaction, in place.
 *
 * `Sentry.prismaIntegration()` reports about ten spans per query, and only the
 * one carrying the SQL is useful. The rest outnumber every other span we
 * send, and they are what spends the monthly span quota.
 *
 * A kept span whose parent is dropped is re-attached to its nearest kept
 * ancestor, so the trace never points at a span that was not sent.
 *
 * @param event - The transaction about to be sent
 */
export function dropPrismaBookkeepingSpans(event: Event): void {
  if (!event.spans?.length) return;

  // span id -> parent id, for every span being dropped
  const droppedParents = new Map<string, string | undefined>();
  for (const span of event.spans) {
    if (isPrismaBookkeepingSpan(span)) {
      droppedParents.set(span.span_id, span.parent_span_id);
    }
  }
  if (droppedParents.size === 0) return;

  const kept: TransactionSpan[] = [];
  for (const span of event.spans) {
    if (droppedParents.has(span.span_id)) continue;

    // Bounded by the number of dropped spans, so a malformed parent loop
    // cannot spin forever.
    let parent = span.parent_span_id;
    for (let hops = 0; hops < droppedParents.size; hops++) {
      if (parent === undefined || !droppedParents.has(parent)) break;
      parent = droppedParents.get(parent);
    }
    kept.push({ ...span, parent_span_id: parent });
  }
  event.spans = kept;
}

/**
 * Removes credentials from the request Sentry attached to an event, in place:
 * every parsed cookie (the session and the SSO verifier and challenge among
 * them), and every `UNLOGGED_HEADERS` header (raw `cookie`, `authorization`,
 * the Cloudflare proxy secret). Sentry's SDK copies the incoming request's
 * headers and cookies onto errors and transactions alike.
 *
 * @param event - The event about to be sent
 */
export function scrubEventRequest(event: Event): void {
  if (event.request?.cookies) {
    delete event.request.cookies;
  }
  if (event.request?.headers) {
    event.request.headers = withoutUnloggedHeaders(event.request.headers);
  }
}

/**
 * Filter for ERROR events (not transactions). Drops:
 *  - non-Error exceptions
 *  - ShelfError instances flagged `shouldBeCaptured: false`
 *  - client-disconnect / abort errors that bypass `makeShelfError`
 *
 * Also scrubs credentials from the request (see {@link scrubEventRequest}) and attaches our ShelfError
 * metadata as Sentry tags / extras. Email masking runs on the result, in the
 * `beforeSend` hook.
 */
function handleBeforeSendError<E extends Event>(event: E, hint: EventHint) {
  const exception = hint.originalException;

  if (
    !(exception instanceof Error) ||
    (isLikeShelfError(exception) && !exception.shouldBeCaptured)
  ) {
    return null;
  }

  // Drop aborted-request errors that bypass `makeShelfError` — usually thrown
  // raw from streaming handlers or middleware when a client disconnects.
  if (isAbortError(exception)) {
    return null;
  }

  // Handled client errors (4xx) are not server faults. They're recorded as a
  // low-severity Sentry log trail (Logger.handledClientError) on the separate
  // logs quota, so keep them OUT of the error-event pipeline entirely; a 4xx
  // call site does not need its own `shouldBeCaptured: false`.
  if (isHandledClientError(exception)) {
    return null;
  }

  scrubEventRequest(event);

  const context = makeSentryContext(exception);
  if (!context) {
    return event;
  }

  return {
    ...event,
    ...context,
    // Merge tags so scope-set values (e.g. organizationId from
    // requirePermission) survive the ShelfError-derived overlay.
    // Without this merge the spread above would clobber event.tags
    // with only { label, shelf_trace_id } and we'd lose org filtering
    // on error events. Same applies to extras.
    tags: { ...(event.tags ?? {}), ...context.tags },
    extra: { ...(event.extra ?? {}), ...context.extra },
    // Prefer the explicit user we set in requirePermission; only fall
    // back to the ShelfError-extracted id if the scope didn't have one.
    user: event.user ?? context.user,
  };
}

/**
 * Keys whose values are credentials/secrets and must NEVER reach Sentry, even
 * if one slips into a ShelfError's `additionalData`. Defense-in-depth: callers
 * shouldn't put secrets in `additionalData` in the first place, but this
 * guarantees a stray one can't be spread into the captured event's `extra`.
 */
const SENSITIVE_KEY_PATTERN =
  /token|password|secret|verifier|cookie|authorization|credential|jwt|api[-_]?key/i;

/**
 * Recursively redact values under sensitive keys. Walks nested objects and
 * arrays (cycle-safe via `seen`) so a secret tucked under a non-sensitive key
 * (e.g. `{ session: { refreshToken } }`) is scrubbed too — not just top-level
 * keys.
 *
 * @param value - The value to walk
 * @param seen - Visited objects, to break reference cycles
 * @returns The value with secret-keyed entries replaced by `"[redacted]"`
 */
function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? "[redacted]"
      : redactValue(val, seen);
  }
  return out;
}

/**
 * Redact a ShelfError's `additionalData` for safe inclusion in a Sentry event's
 * `extra`. Non-object input yields an empty object so the result is spreadable.
 * Defense-in-depth: callers must still avoid putting secrets in `additionalData`
 * at all — this guarantees a stray one (at any depth) can't reach Sentry.
 *
 * @param data - A ShelfError's `additionalData`
 * @returns A deep copy with secret-keyed values replaced by `"[redacted]"`
 */
function redactSecrets(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {};
  }
  return redactValue(data, new WeakSet<object>()) as Record<string, unknown>;
}

/**
 * Build a Sentry overlay (user / tags / extras) from a ShelfError.
 *
 * Everything in `extra` taken from the error (its `additionalData`, `message`
 * and `cause`) also goes through `redactSensitive`, the same pass the log line
 * gets: it strips credentials embedded in URLs and caps each string, so a field
 * as large as the client chose to send cannot reach Sentry whole. `traceId` is
 * a short id the server generates, so it is included as is.
 *
 * Returns `undefined` for anything that isn't a ShelfError so the caller
 * can fall through to the scope-derived event without overlaying noisy
 * fallback tags ("Unknown" / "?"). Plain Errors that bubble up still get
 * captured — they just don't gain Shelf-specific tagging they can't
 * provide meaningful values for.
 */
export function makeSentryContext(exception: unknown) {
  if (!isLikeShelfError(exception)) {
    return;
  }

  return {
    user: {
      id: (exception.additionalData?.userId as string) || "?",
    },
    tags: {
      label: exception.label || "Unknown",
      shelf_trace_id: exception.traceId || "Unknown",
    },
    extra: {
      // redactSecrets first: its walk is cycle-safe, so redactSensitive only
      // ever sees an acyclic tree.
      ...redactSensitive(redactSecrets(exception.additionalData)),
      traceId: exception.traceId,
      message: redactSensitive(exception.message),
      cause: {
        message: redactSensitive((exception.cause as Error | null)?.message),
        // Redact the raw cause chain too; otherwise it bypasses redactSecrets
        // and the "no secret can reach Sentry (at any depth)" guarantee would
        // not actually hold. The object is redacted before it is stringified,
        // because URL credentials are only found in a string that is a URL,
        // and the JSON is capped as a whole.
        raw: redactSensitive(
          JSON.stringify(
            redactSensitive(redactValue(exception.cause, new WeakSet<object>()))
          )
        ),
      },
    },
  };
}
