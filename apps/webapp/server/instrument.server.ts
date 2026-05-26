/* eslint-disable no-console */
/**
 * Server-side Sentry init.
 *
 * Loaded first by `server/index.ts` (before any other module) so that the
 * @sentry/react-router auto-instrumentations (HTTP, Prisma, undici, etc.)
 * can patch their target modules before they are required.
 *
 * History — the previous version routed BOTH `beforeSend` (errors) and
 * `beforeSendTransaction` (performance traces) through the same handler,
 * which inspected `hint.originalException`. Transactions never carry an
 * exception, so they were silently dropped 100% of the time. As a result
 * Sentry collected only client-side spans and no Prisma / loader timing
 * was visible. Errors and transactions are now handled by separate
 * callbacks.
 */
import * as Sentry from "@sentry/react-router";
import { type Event, type EventHint } from "@sentry/react-router";

import { SENTRY_DSN } from "~/utils/env";
import { isAbortError, isLikeShelfError } from "~/utils/error";

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
    integrations: [
      // Emit `span.op:db.sql.prisma` spans for every Prisma query. Requires
      // @prisma/instrumentation (already in the workspace) and Sentry.init
      // running before the Prisma client is imported — server/index.ts
      // imports this file first, so that ordering is preserved.
      Sentry.prismaIntegration(),
    ],
    // Performance Monitoring — 10% sampling matches the client. Tune via
    // a tracesSampler later if specific routes need higher fidelity.
    tracesSampleRate: 0.1,
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
     * Performance transactions are passed through unchanged. Do NOT route
     * them through the error-event filter — transactions carry no
     * exception, and the old code returned null for any event without
     * one, which silently dropped 100% of server traces.
     */
    beforeSendTransaction(event) {
      return event;
    },
    beforeSend(event, hint) {
      return handleBeforeSendError(event, hint);
    },
  });

  if (process.env.NODE_ENV === "production") {
    console.log("Sentry is enabled");
  }
}

/**
 * Filter for ERROR events (not transactions). Drops:
 *  - non-Error exceptions
 *  - ShelfError instances flagged `shouldBeCaptured: false`
 *  - client-disconnect / abort errors that bypass `makeShelfError`
 *
 * Also redacts the auth-session cookie and attaches our ShelfError
 * metadata as Sentry tags / extras.
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

  /** Hide the __authSession cookie */
  if (event.request?.cookies) {
    event.request.cookies["__authSession"] = "hidden";
  }

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
 * Build a Sentry overlay (user / tags / extras) from a ShelfError.
 *
 * Returns `undefined` for anything that isn't a ShelfError so the caller
 * can fall through to the scope-derived event without overlaying noisy
 * fallback tags ("Unknown" / "?"). Plain Errors that bubble up still get
 * captured — they just don't gain Shelf-specific tagging they can't
 * provide meaningful values for.
 */
function makeSentryContext(exception: unknown) {
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
      ...(exception.additionalData || {}),
      traceId: exception.traceId,
      message: exception.message,
      cause: {
        message: (exception.cause as Error | null)?.message,
        raw: JSON.stringify(exception.cause),
      },
    },
  };
}
