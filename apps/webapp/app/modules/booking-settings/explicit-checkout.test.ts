/**
 * Tests for the explicit check-out requirement: which memberships each switch
 * covers, and the 403 the web booking action returns for a refused one-click
 * check-out.
 *
 * @see {@link file://./explicit-checkout.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { accessFor } from "@helpers/role-access";
import { ShelfError } from "~/utils/error";
import { assertQuickCheckoutAllowed } from "./explicit-checkout";

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

/** The check-out switches plus the check-in pair, switched off. */
const withCheckin = (s: typeof BOTH_OFF) => ({
  requireExplicitCheckinForAdmin: false,
  requireExplicitCheckinForSelfService: false,
  ...s,
});

describe("assertQuickCheckoutAllowed", () => {
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
    "%s with %o refuses the one-click check-out: %s",
    (role, settings, refused) => {
      const run = () =>
        assertQuickCheckoutAllowed({
          access: accessFor([role]),
          bookingSettings: withCheckin(settings),
        });
      if (refused) {
        expect(run).toThrow(expect.objectContaining({ status: 403 }));
      } else {
        expect(run).not.toThrow();
      }
    }
  );

  it("judges a mixed membership by its highest role", () => {
    expect(() =>
      assertQuickCheckoutAllowed({
        access: accessFor([
          OrganizationRoles.SELF_SERVICE,
          OrganizationRoles.ADMIN,
        ]),
        bookingSettings: withCheckin(ADMIN_ONLY),
      })
    ).toThrow(expect.objectContaining({ status: 403 }));
  });

  it("ignores the check-in switches", () => {
    expect(() =>
      assertQuickCheckoutAllowed({
        access: accessFor([OrganizationRoles.ADMIN]),
        bookingSettings: {
          ...BOTH_OFF,
          requireExplicitCheckinForAdmin: true,
          requireExplicitCheckinForSelfService: true,
        },
      })
    ).not.toThrow();
  });

  it("refuses with an uncaptured 403 that tells the caller to scan", () => {
    let thrown: unknown;
    try {
      assertQuickCheckoutAllowed({
        access: accessFor([OrganizationRoles.SELF_SERVICE]),
        bookingSettings: withCheckin(SELF_SERVICE_ONLY),
      });
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
});
