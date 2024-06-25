import * as Sentry from "@sentry/remix";
import { isLikeShelfError } from "./error";

/**
 * This initialtes sentry. It has very specific requirements on how to be handled:
 * https://docs.sentry.io/platforms/javascript/guides/remix/manual-setup/#server-side-errors
 * */

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    // auto instrument Remix with OpenTelemetry
    autoInstrumentRemix: true,
    // Performance Monitoring
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
    beforeSendTransaction(event, hint) {
      return handleBeforeSend(event, hint);
    },
    beforeSend(event, hint) {
      return handleBeforeSend(event, hint);
    },
  });
}

/**
 * Filter out non 5xx errors to avoid spamming and log only the necessary.
 */
function handleBeforeSend(event, hint) {
  const exception = hint.originalException;

  if (
    !(exception instanceof Error) ||
    (isLikeShelfError(exception) && !exception.shouldBeCaptured)
  ) {
    return null;
  }

  return {
    ...event,
    ...makeSentryContext(exception),
  };
}

/**
 * Make the Sentry context from our ShelfError
 */
function makeSentryContext(event) {
  if (!event) {
    return;
  }

  const maybeShelfError = event;

  return {
    user: {
      id: maybeShelfError.additionalData?.userId || "?",
    },
    tags: {
      label: maybeShelfError.label || "Unknown",
    },
    extra: {
      ...(maybeShelfError.additionalData || {}),
      traceId: maybeShelfError.traceId,
      message: maybeShelfError.message,
      cause: {
        message: maybeShelfError.cause?.message,
        raw: JSON.stringify(maybeShelfError.cause),
      },
    },
  };
}
