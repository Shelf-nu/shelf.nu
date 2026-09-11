/**
 * Tests for the explicit check-out requirement: which roles each switch covers,
 * and the 403 the web booking action returns for a refused one-click check-out.
 *
 * @see {@link file://./explicit-checkout.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  assertQuickCheckoutAllowed,
  isExplicitCheckoutRequired,
} from "./explicit-checkout";

// @vitest-environment node

const BOTH_ON = {
  requireExplicitCheckoutForAdmin: true,
  requireExplicitCheckoutForSelfService: true,
};
const ADMIN_ONLY = {
  requireExplicitCheckoutForAdmin: true,
  requireExplicitCheckoutForSelfService: false,
};
const SELF_SERVICE_ONLY = {
  requireExplicitCheckoutForAdmin: false,
  requireExplicitCheckoutForSelfService: true,
};
const BOTH_OFF = {
  requireExplicitCheckoutForAdmin: false,
  requireExplicitCheckoutForSelfService: false,
};

describe("isExplicitCheckoutRequired", () => {
  it.each([
    [OrganizationRoles.ADMIN, ADMIN_ONLY, true],
    [OrganizationRoles.ADMIN, SELF_SERVICE_ONLY, false],
    [OrganizationRoles.SELF_SERVICE, SELF_SERVICE_ONLY, true],
    [OrganizationRoles.SELF_SERVICE, ADMIN_ONLY, false],
    // OWNER is exempt and BASE is not covered, whatever the switches say.
    [OrganizationRoles.OWNER, BOTH_ON, false],
    [OrganizationRoles.BASE, BOTH_ON, false],
    [OrganizationRoles.ADMIN, BOTH_OFF, false],
    [OrganizationRoles.SELF_SERVICE, BOTH_OFF, false],
  ])(
    "%s with %o requires explicit check-out: %s",
    (role, settings, expected) => {
      expect(
        isExplicitCheckoutRequired({ role, bookingSettings: settings })
      ).toBe(expected);
    }
  );
});

describe("assertQuickCheckoutAllowed", () => {
  it.each([
    [OrganizationRoles.ADMIN, ADMIN_ONLY],
    [OrganizationRoles.SELF_SERVICE, SELF_SERVICE_ONLY],
  ])("refuses a %s with a 403 when its switch is on", (role, settings) => {
    let thrown: unknown;
    try {
      assertQuickCheckoutAllowed({ role, bookingSettings: settings });
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const error = thrown as ShelfError;
    expect(error.status).toBe(403);
    expect(error.title).toBe("Not allowed to quick check-out");
    expect(error.message).toBe(
      "Explicit check-out is required in this organization. Please scan or select the assets to check them out."
    );
    // A refused one-click check-out is an expected outcome, not a fault.
    expect(error.shouldBeCaptured).toBe(false);
  });

  it.each([
    [OrganizationRoles.OWNER, BOTH_ON],
    [OrganizationRoles.BASE, BOTH_ON],
    [OrganizationRoles.ADMIN, SELF_SERVICE_ONLY],
    [OrganizationRoles.SELF_SERVICE, ADMIN_ONLY],
  ])("lets a %s check out in one click under %o", (role, settings) => {
    expect(() =>
      assertQuickCheckoutAllowed({ role, bookingSettings: settings })
    ).not.toThrow();
  });
});
