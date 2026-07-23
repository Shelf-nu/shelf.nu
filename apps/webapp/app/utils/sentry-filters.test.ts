/**
 * Tests for the client Sentry `beforeSend` drop/keep rules
 * ({@link handleClientBeforeSend}) and the expected-status helper
 * ({@link isExpectedErrorBoundaryStatus}).
 *
 * Focus: the two Sentry-hygiene behaviors added on top of the existing
 * hard-filters —
 *  - unactionable client noise (DataCloneError, bare gateway-status blips) is
 *    dropped, while
 *  - expected error-boundary terminal states (403/404) are dropped but every
 *    other boundary status (incl. 5xx) still passes through.
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
  it("is true only for 403 and 404", () => {
    expect(isExpectedErrorBoundaryStatus(403)).toBe(true);
    expect(isExpectedErrorBoundaryStatus(404)).toBe(true);
  });

  it("is false for other 4xx, all 5xx, and undefined/NaN", () => {
    for (const status of [400, 409, 422, 429, 500, 502]) {
      expect(isExpectedErrorBoundaryStatus(status)).toBe(false);
    }
    expect(isExpectedErrorBoundaryStatus(undefined)).toBe(false);
    expect(isExpectedErrorBoundaryStatus(NaN)).toBe(false);
  });
});

describe("handleClientBeforeSend — noise filters", () => {
  it("drops DataCloneError (unactionable structuredClone/postMessage noise)", () => {
    const event = makeEvent({
      type: "DataCloneError",
      value: "The object can not be cloned.",
    });
    expect(handleClientBeforeSend(event)).toBeNull();
  });

  it("drops a bare gateway-status blip (Error: 502 with no first-party frames)", () => {
    for (const code of ["502", "503", "504"]) {
      expect(handleClientBeforeSend(makeEvent({ value: code }))).toBeNull();
    }
  });

  it("keeps a genuine Error('502') that carries first-party frames", () => {
    // A real throw from our own code has in_app frames → must stay capturable
    const event = makeEvent({ value: "502", inApp: true });
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("keeps a non-gateway numeric message (e.g. 404 as text) — pattern is 5xx-only", () => {
    const event = makeEvent({ value: "404" });
    expect(handleClientBeforeSend(event)).toBe(event);
  });

  it("still drops pre-existing hard-filtered noise (AbortError, <unknown>)", () => {
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
