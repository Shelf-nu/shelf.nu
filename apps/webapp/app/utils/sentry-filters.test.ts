/**
 * Tests for the client Sentry `beforeSend` drop/keep rules
 * ({@link handleClientBeforeSend}) and the expected-status helper
 * ({@link isExpectedErrorBoundaryStatus}).
 *
 * Focus: the Sentry-hygiene behaviors on top of the plain hard-filters:
 *  - unactionable client noise (DataCloneError from outside the client bundle,
 *    gateway status errors) is dropped, while
 *  - expected error-boundary terminal states (403/404/429) are dropped but
 *    every other boundary status (incl. 5xx) still passes through.
 *
 * @see {@link file://./sentry-filters.ts}
 */
import type { ErrorEvent } from "@sentry/react-router";
import { describe, expect, it } from "vitest";

import {
  handleClientBeforeSend,
  isExpectedErrorBoundaryStatus,
} from "./sentry-filters";

/**
 * Minimal single-exception Sentry error event. `type`/`value` mirror how
 * Sentry serializes an Error (constructor name into `type`, message into
 * `value`); `tags`/`inApp` model the two axes the rules branch on.
 */
function makeEvent(opts: {
  type?: string;
  value?: string;
  tags?: Record<string, string>;
  inApp?: boolean;
}): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: opts.type ?? "Error",
          value: opts.value ?? "",
          ...(opts.inApp !== undefined
            ? { stacktrace: { frames: [{ in_app: opts.inApp }] } }
            : {}),
        },
      ],
    },
    ...(opts.tags ? { tags: opts.tags } : {}),
  } as ErrorEvent;
}

describe("isExpectedErrorBoundaryStatus", () => {
  it("is true only for 403, 404, and 429", () => {
    expect(isExpectedErrorBoundaryStatus(403)).toBe(true);
    expect(isExpectedErrorBoundaryStatus(404)).toBe(true);
    // 429 (rate limited) is transient by design, not a bug to triage — see
    // SHELF-WEBAPP-21S/221 (appLoaderRateLimit tripped by revalidations,
    // surfaced through the generic "unexpected error" boundary).
    expect(isExpectedErrorBoundaryStatus(429)).toBe(true);
  });

  it("is false for other 4xx, all 5xx, and undefined/NaN", () => {
    for (const status of [400, 409, 422, 500, 502]) {
      expect(isExpectedErrorBoundaryStatus(status)).toBe(false);
    }
    expect(isExpectedErrorBoundaryStatus(undefined)).toBe(false);
    expect(isExpectedErrorBoundaryStatus(NaN)).toBe(false);
  });
});

/**
 * An exception with one stack frame at `filename`, marked `in_app` like every
 * frame the browser SDK parses.
 */
function eventWithFrame(opts: {
  type: string;
  value: string;
  filename: string;
  tags?: Record<string, string>;
}): ErrorEvent {
  return {
    exception: {
      values: [
        {
          type: opts.type,
          value: opts.value,
          stacktrace: {
            frames: [{ filename: opts.filename, in_app: true }],
          },
        },
      ],
    },
    ...(opts.tags ? { tags: opts.tags } : {}),
  } as ErrorEvent;
}

const BUNDLE_FRAME = "https://app.shelf.nu/file-assets/abc123/chunk-X1.js";
const EXTENSION_FRAME = "chrome-extension://abcdefgh/content.js";

describe("handleClientBeforeSend: DataCloneError", () => {
  const DATA_CLONE = {
    type: "DataCloneError",
    value: "The object can not be cloned.",
  };

  it("drops one with no stack", () => {
    expect(handleClientBeforeSend(makeEvent(DATA_CLONE))).toBeNull();
  });

  it("drops one thrown by an extension script, even though the SDK marks its frame in_app", () => {
    expect(
      handleClientBeforeSend(
        eventWithFrame({ ...DATA_CLONE, filename: EXTENSION_FRAME })
      )
    ).toBeNull();
  });

  it("keeps one thrown from the client bundle (a fixable app bug)", () => {
    const event = eventWithFrame({ ...DATA_CLONE, filename: BUNDLE_FRAME });
    expect(handleClientBeforeSend(event)).toBe(event);
  });
});

describe("handleClientBeforeSend: gateway status errors", () => {
  it.each(["502", "503", "504", "520 ", "521", "522", "523", "524"])(
    "drops a bare %s with no stack",
    (value) => {
      expect(handleClientBeforeSend(makeEvent({ value }))).toBeNull();
    }
  );

  it("drops the route manifest fetch failing with a gateway status, though its frames are in the bundle", () => {
    // React Router throws `${status} ${statusText}` from the client bundle
    // when /__manifest answers with an error; statusText is empty over HTTP/2
    const event = eventWithFrame({
      type: "Error",
      value: "520 ",
      filename: BUNDLE_FRAME,
      tags: { source: "error-boundary" },
    });
    expect(handleClientBeforeSend(event)).toBeNull();
  });

  it("keeps an error whose linked cause is a gateway status", () => {
    // Sentry lists chained exceptions oldest first: the cause, then the error
    // that wrapped it
    const event = {
      exception: {
        values: [
          {
            type: "Error",
            value: "502",
            stacktrace: { frames: [{ filename: BUNDLE_FRAME, in_app: true }] },
          },
          {
            type: "Error",
            value: "Could not restore the booking draft",
            stacktrace: { frames: [{ filename: BUNDLE_FRAME, in_app: true }] },
          },
        ],
      },
      tags: { source: "error-boundary" },
    } as ErrorEvent;
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("drops one that carries a reason phrase", () => {
    expect(
      handleClientBeforeSend(makeEvent({ value: "502 Bad Gateway" }))
    ).toBeNull();
  });

  it.each(["500", "501", "404", "5020", "502 then something broke: x"])(
    "keeps %s",
    (value) => {
      const event = makeEvent({ value });
      expect(handleClientBeforeSend(event)).toBe(event);
    }
  );

  it("keeps a TypeError that happens to read 502", () => {
    const event = makeEvent({ type: "TypeError", value: "502" });
    expect(handleClientBeforeSend(event)).toBe(event);
  });
});

describe("handleClientBeforeSend: hard-filtered noise", () => {
  it("still drops AbortError and <unknown>", () => {
    expect(
      handleClientBeforeSend(
        makeEvent({ type: "AbortError", value: "The operation was aborted" })
      )
    ).toBeNull();
    expect(
      handleClientBeforeSend(makeEvent({ value: "<unknown>" }))
    ).toBeNull();
  });
});

describe("handleClientBeforeSend: crypto wallet scripts injected into the page", () => {
  /**
   * A wallet error as the browser SDK reports it: one frame at `filename`,
   * marked `in_app` like every frame the SDK parses.
   */
  function walletEvent(value: string, filename: string): ErrorEvent {
    return {
      exception: {
        values: [
          {
            type: "TypeError",
            value,
            stacktrace: {
              frames: [{ filename, lineno: 1, colno: 16, in_app: true }],
            },
          },
        ],
      },
    } as ErrorEvent;
  }

  const SAFARI_MESSAGE =
    "undefined is not an object (evaluating 'window.ethereum.selectedAddress = undefined')";
  const CHROMIUM_MESSAGE =
    "Cannot set properties of undefined (setting 'selectedAddress')";

  it("drops a script injected inline into the page document", () => {
    expect(
      handleClientBeforeSend(
        walletEvent(
          SAFARI_MESSAGE,
          "https://app.shelf.nu/account-details/general"
        )
      )
    ).toBeNull();
  });

  it.each([
    "chrome-extension://abcdefgh/inpage.js",
    "moz-extension://1234-5678/inpage.js",
    "safari-web-extension://ABCD/inpage.js",
  ])("drops a script served by an extension (%s)", (filename) => {
    expect(
      handleClientBeforeSend(walletEvent(CHROMIUM_MESSAGE, filename))
    ).toBeNull();
  });

  it("drops the message when it arrives with no stack", () => {
    expect(
      handleClientBeforeSend(
        makeEvent({ type: "TypeError", value: CHROMIUM_MESSAGE })
      )
    ).toBeNull();
  });

  it("keeps a wallet error that our own code caught and rethrew", () => {
    const wallet = walletEvent(
      CHROMIUM_MESSAGE,
      "chrome-extension://abcdefgh/inpage.js"
    );
    const event = {
      exception: {
        values: [
          ...(wallet.exception?.values ?? []),
          {
            type: "Error",
            value: "Could not connect the wallet",
            stacktrace: {
              frames: [
                {
                  filename:
                    "https://app.shelf.nu/file-assets/abc123/root-X1.js",
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
    } as ErrorEvent;
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("keeps the same wording when it comes from the client bundle", () => {
    const event = walletEvent(
      CHROMIUM_MESSAGE,
      "https://app.shelf.nu/file-assets/abc123/root-X1.js"
    );
    expect(handleClientBeforeSend(event)).toBe(event);
  });
});

describe("handleClientBeforeSend: JavaScript chunks that fail to load", () => {
  it.each([
    "Failed to fetch dynamically imported module: https://app.shelf.nu/file-assets/abc/assets._index-X1.js",
    "error loading dynamically imported module: https://app.shelf.nu/file-assets/abc/assets._index-X1.js",
    "Importing a module script failed.",
  ])("keeps %s", (value) => {
    const event = makeEvent({ type: "TypeError", value });
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("still drops an interrupted data request", () => {
    expect(
      handleClientBeforeSend(
        makeEvent({ type: "TypeError", value: "Failed to fetch" })
      )
    ).toBeNull();
  });
});

describe("handleClientBeforeSend — error-boundary allowlist", () => {
  it("drops an expected 403 boundary event", () => {
    const event = makeEvent({
      value: "This scan can no longer be updated",
      tags: { source: "error-boundary", status: "403" },
    });
    expect(handleClientBeforeSend(event)).toBeNull();
  });

  it("drops an expected 404 boundary event", () => {
    const event = makeEvent({
      value: "Asset not found",
      tags: { source: "error-boundary", status: "404" },
    });
    expect(handleClientBeforeSend(event)).toBeNull();
  });

  it("drops an expected 429 (rate limited) boundary event", () => {
    const event = makeEvent({
      value: "Too many requests. Please try again later.",
      tags: { source: "error-boundary", status: "429" },
    });
    expect(handleClientBeforeSend(event)).toBeNull();
  });

  it("keeps a 5xx boundary event (still user-visible, still searchable by Error ID)", () => {
    const event = makeEvent({
      value: "Internal error",
      tags: { source: "error-boundary", status: "500" },
    });
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("keeps an unexpected 4xx boundary event (409) unchanged", () => {
    const event = makeEvent({
      value: "Conflict",
      tags: { source: "error-boundary", status: "409" },
    });
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("keeps a boundary event with no status tag (client-side JS crash)", () => {
    const event = makeEvent({
      type: "TypeError",
      value: "Cannot read properties of undefined",
      tags: { source: "error-boundary" },
    });
    expect(handleClientBeforeSend(event)).toBe(event);
  });
});

describe("handleClientBeforeSend — non-boundary passthrough", () => {
  it("keeps a normal uncaught client error (no source tag)", () => {
    // Represents a genuine 5xx-equivalent crash Sentry should still receive
    const event = makeEvent({
      type: "TypeError",
      value: "Something genuinely broke",
      inApp: true,
    });
    expect(handleClientBeforeSend(event)).toBe(event);
  });
});

/**
 * An unhandled rejection as Sentry reports it for a non-Error value: the
 * message names the keys, the mechanism names the global handler, and the
 * rejected object itself lands on `extra.__serialized__`.
 */
function makeRejectionEvent(serialized: Record<string, unknown>): ErrorEvent {
  const event: ErrorEvent = {
    type: undefined,
    exception: {
      values: [
        {
          type: "UnhandledRejection",
          value: `Object captured as promise rejection with keys: ${Object.keys(
            serialized
          ).join(", ")}`,
          mechanism: {
            type: "auto.browser.global_handlers.onunhandledrejection",
            handled: false,
          },
        },
      ],
    },
    extra: { __serialized__: serialized },
  };
  return event;
}

/** A route error response as a loader's `throw data(error(reason), { status })` produces it. */
function routeErrorResponse(status: number) {
  return {
    __type: "RouteErrorResponse",
    data: { error: "[Object]" },
    internal: false,
    status,
    statusText: "Internal Server Error",
  };
}

describe("handleClientBeforeSend: unhandled route error rejections", () => {
  it.each([403, 404, 429])(
    "drops an unhandled %i route error response",
    (status) => {
      expect(
        handleClientBeforeSend(makeRejectionEvent(routeErrorResponse(status)))
      ).toBeNull();
    }
  );

  it("drops one without the __type marker (older serializations)", () => {
    const { __type: _ignored, ...withoutType } = routeErrorResponse(404);
    expect(handleClientBeforeSend(makeRejectionEvent(withoutType))).toBeNull();
  });

  it("keeps an unhandled 500 route error response", () => {
    const event = makeRejectionEvent(routeErrorResponse(500));
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("keeps a rejected object that is not a route error response", () => {
    const event = makeRejectionEvent({ status: 404, message: "custom" });
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("keeps a 404-shaped object that was not an unhandled rejection", () => {
    const event = {
      ...makeRejectionEvent(routeErrorResponse(404)),
      exception: {
        values: [
          { type: "Error", value: "boom", mechanism: { type: "generic" } },
        ],
      },
    } as ErrorEvent;
    expect(handleClientBeforeSend(event)).toBe(event);
  });
});
