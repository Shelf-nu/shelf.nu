/**
 * Advanced Reports gate.
 *
 * @see {@link file://./advanced-reports.validator.server.ts}
 */

import { describe, expect, it, vi } from "vitest";

// why: the gate short-circuits to "allowed" when premium features are off
// (self-hosted); the tests pin both readings of the flag.
vi.mock("~/utils/subscription.server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    canUseAdvancedReports: (org: { advancedReportsEnabled: boolean }) =>
      org.advancedReportsEnabled,
  };
});

import { ShelfError } from "~/utils/error";
import {
  organizationHasAdvancedReportsEnabled,
  validateAdvancedReportsEnabled,
} from "./advanced-reports.validator.server";

describe("advanced reports validator", () => {
  it("answers false for a missing workspace and follows the flag otherwise", () => {
    expect(organizationHasAdvancedReportsEnabled(null)).toBe(false);
    expect(organizationHasAdvancedReportsEnabled(undefined)).toBe(false);
    expect(
      organizationHasAdvancedReportsEnabled({ advancedReportsEnabled: false })
    ).toBe(false);
    expect(
      organizationHasAdvancedReportsEnabled({ advancedReportsEnabled: true })
    ).toBe(true);
  });

  it("throws a 403 that is not captured when the add-on is off", () => {
    let caught: unknown;
    try {
      validateAdvancedReportsEnabled(
        { advancedReportsEnabled: false },
        { userId: "u-1" }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ShelfError);
    const shelfError = caught as ShelfError;
    expect(shelfError.status).toBe(403);
    expect(shelfError.shouldBeCaptured).toBe(false);
    expect(shelfError.additionalData).toEqual({ userId: "u-1" });
  });

  it("passes silently when the add-on is on", () => {
    expect(() =>
      validateAdvancedReportsEnabled({ advancedReportsEnabled: true })
    ).not.toThrow();
  });
});
