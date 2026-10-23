/**
 * Tests for the feedback submission schema: the user-authored fields keep
 * their existing constraints and the auto-captured context fields stay
 * optional but bounded.
 *
 * @see {@link file://./schema.ts}
 */
import { describe, expect, it } from "vitest";

import { feedbackSchema } from "./schema";

const VALID_BASE = {
  type: "issue",
  message: "The asset list shows the wrong creation time",
};

describe("feedbackSchema", () => {
  it("accepts a submission without any context fields", () => {
    const result = feedbackSchema.safeParse(VALID_BASE);
    expect(result.success).toBe(true);
  });

  it("accepts a submission with context and error fields", () => {
    const result = feedbackSchema.safeParse({
      ...VALID_BASE,
      currentUrl: "https://app.shelf.nu/assets",
      viewport: "1512x824 @2x",
      traceId: "trace_789",
      sentryEventId: "evt_abc",
      errorStatus: "500",
      errorTitle: "Oops, something went wrong",
      errorMessage: "Something went wrong while fetching the kit",
    });
    expect(result.success).toBe(true);
  });

  it("still rejects too-short messages", () => {
    const result = feedbackSchema.safeParse({
      ...VALID_BASE,
      message: "short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects oversized context values", () => {
    const result = feedbackSchema.safeParse({
      ...VALID_BASE,
      currentUrl: "https://app.shelf.nu/".padEnd(3000, "a"),
    });
    expect(result.success).toBe(false);
  });
});
