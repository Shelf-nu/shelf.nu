/**
 * Tests for the shared pg-boss last-attempt check.
 *
 * @see {@link file://./job-retry.ts}
 */
import { describe, expect, it } from "vitest";
import { isLastAttempt } from "./job-retry";

describe("isLastAttempt", () => {
  it("is true only on the attempt whose retry count has reached the limit", () => {
    expect(isLastAttempt({ retrycount: 0, retrylimit: 2 })).toBe(false);
    expect(isLastAttempt({ retrycount: 1, retrylimit: 2 })).toBe(false);
    expect(isLastAttempt({ retrycount: 2, retrylimit: 2 })).toBe(true);
  });

  it("is true for a job queued without retries", () => {
    expect(isLastAttempt({ retrycount: 0, retrylimit: 0 })).toBe(true);
  });

  it("is false when the job carries no retry metadata", () => {
    expect(isLastAttempt({})).toBe(false);
    expect(isLastAttempt({ retrycount: 3, retrylimit: null })).toBe(false);
  });
});
