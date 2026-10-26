/**
 * The ShelfError overlay merged into every captured Sentry error event.
 *
 * `extra` is built from the error's `additionalData`, message and cause, all of
 * which can carry user-submitted values. It must not leak a credential and must
 * stay bounded, matching what the log line gets from `redactSensitive`.
 *
 * @see {@link file://./instrument.server.ts} `makeSentryContext`
 * @see {@link file://./../app/utils/redact.ts}
 */
import { describe, expect, it } from "vitest";

import { ShelfError } from "~/utils/error";
import { MAX_LOGGED_STRING_LENGTH } from "~/utils/redact";
import { makeSentryContext } from "./instrument.server";

/** `extra` spreads arbitrary `additionalData` keys, so tests read it as a record. */
function extraOf(error: ShelfError): Record<string, unknown> | undefined {
  return makeSentryContext(error)?.extra;
}

// @vitest-environment node

describe("makeSentryContext", () => {
  it("caps long strings in additionalData", () => {
    const huge = "x".repeat(800_000);
    const error = new ShelfError({
      cause: null,
      message: "Upload failed",
      label: "File storage",
      additionalData: { imageUrl: huge },
    });

    const extra = extraOf(error);

    expect(String(extra?.imageUrl).length).toBeLessThan(
      MAX_LOGGED_STRING_LENGTH + 100
    );
  });

  it("strips credentials from a URL in additionalData", () => {
    const error = new ShelfError({
      cause: null,
      message: "Upload failed",
      label: "File storage",
      additionalData: { imageUrl: "https://user:hunter2@example.com/a.png" },
    });

    expect(JSON.stringify(extraOf(error))).not.toContain("hunter2");
  });

  it("bounds the message and the serialized cause", () => {
    const huge = "y".repeat(800_000);
    const error = new ShelfError({
      cause: new ShelfError({
        cause: null,
        message: huge,
        label: "Assets",
        additionalData: { data: huge },
      }),
      message: huge,
      label: "Assets",
    });

    const extra = extraOf(error);

    expect(JSON.stringify(extra).length).toBeLessThan(
      MAX_LOGGED_STRING_LENGTH * 4
    );
  });

  it("still redacts secret-keyed values", () => {
    const error = new ShelfError({
      cause: null,
      message: "Refresh failed",
      label: "Auth",
      additionalData: { refreshToken: "s3cr3t", userId: "user-1" },
    });

    const extra = extraOf(error);

    expect(JSON.stringify(extra)).not.toContain("s3cr3t");
    expect(extra?.userId).toBe("user-1");
  });
});
