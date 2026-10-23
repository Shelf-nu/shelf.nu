/**
 * resolveBillingSectionState - unit tests
 *
 * Pins which "Billed to you" content each kind of user gets on the account
 * subscription page.
 *
 * @see {@link file://./billing-section.ts}
 */
import { describe, expect, it } from "vitest";
import { resolveBillingSectionState } from "./billing-section";

describe("resolveBillingSectionState", () => {
  it("offers a plan of their own to a non-payer working in someone else's paid workspace", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: false,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: true,
        canPurchase: true,
      })
    ).toBe("own-plan-options");
  });

  it("shows the pricing table to a non-payer with no paid access", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: false,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: false,
        canPurchase: true,
      })
    ).toBe("choose-plan");
  });

  it("nudges an add-on-only subscriber with no paid access towards a workspace plan", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: true,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: false,
        canPurchase: true,
      })
    ).toBe("no-workspace-plan");
  });

  it("does not tell an add-on-only subscriber in a paid workspace they have no plan", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: true,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: true,
        canPurchase: true,
      })
    ).toBe("subscribed");
  });

  it.each([true, false])(
    "shows only the subscriptions to a workspace-plan subscriber (paid access through others: %s)",
    (hasPaidAccessThroughOthers) => {
      expect(
        resolveBillingSectionState({
          hasSubscription: true,
          hasWorkspacePlan: true,
          hasPaidAccessThroughOthers,
          canPurchase: true,
        })
      ).toBe("subscribed");
    }
  );

  describe("when the user may not purchase", () => {
    it.each([
      { name: "own-plan-options", sub: false, plan: false, others: true },
      { name: "choose-plan", sub: false, plan: false, others: false },
      { name: "no-workspace-plan", sub: true, plan: false, others: false },
    ])(
      "replaces $name with the purchases-unavailable notice",
      ({ sub, plan, others }) => {
        expect(
          resolveBillingSectionState({
            hasSubscription: sub,
            hasWorkspacePlan: plan,
            hasPaidAccessThroughOthers: others,
            canPurchase: false,
          })
        ).toBe("purchases-unavailable");
      }
    );

    it("keeps the subscribed state so the portal and invoices stay reachable", () => {
      expect(
        resolveBillingSectionState({
          hasSubscription: true,
          hasWorkspacePlan: true,
          hasPaidAccessThroughOthers: false,
          canPurchase: false,
        })
      ).toBe("subscribed");
    });
  });
});
