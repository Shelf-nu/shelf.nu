import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import SelectPlan from "./select-plan";

// why: avoid database connections triggered by permission checks in the loader module
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: prevent Prisma access when loader selects user data
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

// why: skip Stripe client initialization during route import
vi.mock("~/utils/stripe.server", () => ({
  getStripeCustomer: vi.fn(),
  getStripePricesForTrialPlanSelection: vi.fn(),
}));

const mockUseLoaderData = vi.fn();
const mockUseNavigation = vi.fn();

// why: route reads Remix loader data and navigation state; mock Link for anchor assertions
vi.mock("@remix-run/react", async () => {
  const actual = (await vi.importActual("@remix-run/react")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    useLoaderData: () => mockUseLoaderData(),
    useNavigation: () => mockUseNavigation(),
    Link: ({ to, children, ...rest }: any) => (
      <a {...rest} href={typeof to === "string" ? to : undefined}>
        {children}
      </a>
    ),
  };
});

// why: simplify custom Form wrapper to avoid Remix context requirements in tests
vi.mock("~/components/custom-form", () => ({
  Form: ({ children, ...props }: any) => <form {...props}>{children}</form>,
}));

describe("SelectPlan", () => {
  beforeEach(() => {
    mockUseLoaderData.mockReturnValue({
      prices: [
        {
          id: "price_month",
          unit_amount: 6700,
          currency: "usd",
          recurring: { interval: "month" },
          product: { metadata: { shelf_tier: "tier_2" } },
        },
        {
          id: "price_year",
          unit_amount: 37000,
          currency: "usd",
          recurring: { interval: "year" },
          product: { metadata: { shelf_tier: "tier_2" } },
        },
      ],
    });
    mockUseNavigation.mockReturnValue({ state: "idle" });
  });

  it("renders the updated subtitle, plan options, and pricing copy", () => {
    render(<SelectPlan />);

    expect(
      screen.getByText(
        "No credit card or payment required to start your 7-day trial."
      )
    ).toBeInTheDocument();

    const monthlyCard = screen.getByRole("radio", { name: /monthly/i });
    const monthlyCardContainer = monthlyCard.closest("label");
    expect(monthlyCardContainer).not.toBeNull();
    if (monthlyCardContainer) {
      expect(within(monthlyCardContainer).getByText("$67/mo")).toBeVisible();
      expect(
        within(monthlyCardContainer).getByText("Billed monthly per workspace")
      ).toBeVisible();
    }

    const annualCard = screen.getByRole("radio", { name: /annual/i });
    const annualCardContainer = annualCard.closest("label");
    expect(annualCardContainer).not.toBeNull();
    if (annualCardContainer) {
      expect(within(annualCardContainer).getByText("$37/mo")).toBeVisible();
      expect(
        within(annualCardContainer).getByText(
          "Billed annually $370 per workspace"
        )
      ).toBeVisible();
    }
  });

  it("shows the optional add-ons section with both cards", () => {
    render(<SelectPlan />);

    expect(
      screen.getByRole("heading", { name: "Optional add-ons" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Advanced capabilities for migrations & IT environments."
      )
    ).toBeInTheDocument();

    const alternativeCard = screen
      .getByText("Alternative Barcodes")
      .closest("article");
    expect(alternativeCard).not.toBeNull();
    if (alternativeCard) {
      expect(
        within(alternativeCard).getByText("Paid add-on ($14/mo or $170/yr)")
      ).toBeVisible();
      expect(
        within(alternativeCard).getByText(
          "Keep your existing labels. Supports Code128, Code39, EAN-13, DataMatrix — ideal for migrations."
        )
      ).toBeVisible();
      expect(
        within(alternativeCard).getByText(
          "Enable any time by contacting our team."
        )
      ).toBeVisible();
    }

    const ssoCard = screen
      .getByText("SSO Integration (Team only)")
      .closest("article");
    expect(ssoCard).not.toBeNull();
    if (ssoCard) {
      expect(within(ssoCard).getByText("Paid add-on")).toBeVisible();
      expect(
        within(ssoCard).getByText(
          "Single sign-on for your organization; centralized identity & access."
        )
      ).toBeVisible();
      expect(
        within(ssoCard).getByText(
          "Available for Team workspaces. Pricing provided during evaluation."
        )
      ).toBeVisible();
    }
  });

  it("includes the updated CTA, analytics hook, footer message, and back link", () => {
    render(<SelectPlan />);

    const cta = screen.getByRole("button", { name: "Start 7-day free trial" });
    expect(cta).toHaveAttribute("data-analytics", "cta-start-trial");

    expect(
      screen.getByText(
        "You won’t be charged during the trial. After 7 days, continue on Team or change plans."
      )
    ).toBeInTheDocument();

    const backLink = screen.getByRole("link", { name: "Back" });
    expect(backLink).toHaveAttribute("href", "/welcome");
  });
});
