/**
 * OwnPlanOptions - unit tests
 *
 * Pins the offer shown to a member who pays for nothing: both ways to get a
 * plan of their own, the pricing table each CTA opens, the yearly price
 * quoted from the same Stripe prices the table lists, and the reassurance
 * that the workspace they work in today is unaffected.
 *
 * @see {@link file://./own-plan-options.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { findYearlyPriceForTier, OwnPlanOptions } from "./own-plan-options";
import type { PriceWithProduct } from "./prices";

/**
 * Builds the subset of a Stripe price the pricing surfaces read. Stripe's
 * full `Price` type has dozens of fields irrelevant here, hence the cast.
 */
function buildPrice({
  id,
  tier,
  unitAmount,
  interval = "year",
  metadata = { show_on_table: "true" },
}: {
  id: string;
  tier: string;
  unitAmount: number;
  interval?: "year" | "month";
  metadata?: Record<string, string>;
}): PriceWithProduct {
  return {
    id,
    currency: "usd",
    unit_amount: unitAmount,
    recurring: { interval },
    metadata,
    product: { name: tier, metadata: { shelf_tier: tier } },
  } as unknown as PriceWithProduct;
}

const PRICES = {
  year: [
    buildPrice({ id: "plus-year", tier: "tier_1", unitAmount: 19000 }),
    buildPrice({ id: "team-year", tier: "tier_2", unitAmount: 37000 }),
  ],
  month: [
    buildPrice({
      id: "team-month",
      tier: "tier_2",
      unitAmount: 3400,
      interval: "month",
    }),
  ],
};

describe("OwnPlanOptions", () => {
  it("offers a Team workspace and a Plus upgrade, naming the current workspace", () => {
    render(
      <OwnPlanOptions
        prices={PRICES}
        currentWorkspaceName="Acme Studio"
        onComparePlans={vi.fn()}
      />
    );

    expect(
      screen.getByText("Start your own Team workspace")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Upgrade your personal workspace")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It doesn't change anything in Acme Studio\./)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Your access in Acme Studio stays the same\./)
    ).toBeInTheDocument();
  });

  it("offers only the Team workspace to a user without a personal workspace", () => {
    render(
      <OwnPlanOptions
        prices={PRICES}
        currentWorkspaceName="Acme Studio"
        showPersonalUpgrade={false}
        onComparePlans={vi.fn()}
      />
    );

    expect(
      screen.getByText("Start your own Team workspace")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Upgrade your personal workspace")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Upgrade to Plus" })
    ).not.toBeInTheDocument();
  });

  it.each(["Start a Team workspace", "Upgrade to Plus", "Compare all plans"])(
    "opens the pricing table from '%s'",
    async (label) => {
      const onComparePlans = vi.fn();
      render(
        <OwnPlanOptions
          prices={PRICES}
          currentWorkspaceName="Acme Studio"
          onComparePlans={onComparePlans}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: label }));

      expect(onComparePlans).toHaveBeenCalledTimes(1);
    }
  );

  it("quotes the yearly price of each plan", () => {
    render(
      <OwnPlanOptions
        prices={PRICES}
        currentWorkspaceName="Acme Studio"
        onComparePlans={vi.fn()}
      />
    );

    expect(screen.getByText("from $370/yr")).toBeInTheDocument();
    expect(screen.getByText("from $190/yr")).toBeInTheDocument();
  });

  it("omits the price line when no yearly price is listed for a plan", () => {
    render(
      <OwnPlanOptions
        prices={{ month: PRICES.month }}
        currentWorkspaceName="Acme Studio"
        onComparePlans={vi.fn()}
      />
    );

    expect(screen.queryByText(/\/yr$/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start a Team workspace" })
    ).toBeInTheDocument();
  });
});

describe("findYearlyPriceForTier", () => {
  it("returns the listed yearly price for the tier", () => {
    expect(findYearlyPriceForTier(PRICES, "tier_2")?.id).toBe("team-year");
    expect(findYearlyPriceForTier(PRICES, "tier_1")?.id).toBe("plus-year");
  });

  it("skips prices the pricing table hides", () => {
    const prices = {
      year: [
        buildPrice({
          id: "team-legacy",
          tier: "tier_2",
          unitAmount: 20000,
          metadata: { show_on_table: "true", legacy: "true" },
        }),
        buildPrice({
          id: "team-hidden",
          tier: "tier_2",
          unitAmount: 25000,
          metadata: {},
        }),
      ],
    };

    expect(findYearlyPriceForTier(prices, "tier_2")).toBeUndefined();
  });

  it("returns undefined when there are no yearly prices", () => {
    expect(findYearlyPriceForTier({}, "tier_1")).toBeUndefined();
  });
});
