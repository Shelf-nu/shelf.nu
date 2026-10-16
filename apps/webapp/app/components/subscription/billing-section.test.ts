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
      })
    ).toBe("own-plan-options");
  });

  it("shows the pricing table to a non-payer with no paid access", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: false,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: false,
      })
    ).toBe("choose-plan");
  });

  it("nudges an add-on-only subscriber with no paid access towards a workspace plan", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: true,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: false,
      })
    ).toBe("no-workspace-plan");
  });

  it("does not tell an add-on-only subscriber in a paid workspace they have no plan", () => {
    expect(
      resolveBillingSectionState({
        hasSubscription: true,
        hasWorkspacePlan: false,
        hasPaidAccessThroughOthers: true,
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
        })
      ).toBe("subscribed");
    }
  );
});
