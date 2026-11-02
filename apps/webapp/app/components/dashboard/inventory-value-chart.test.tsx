import type { Currency } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatCurrency } from "~/utils/currency";
import InventoryValueChart, {
  getFittedValueFontSize,
} from "./inventory-value-chart";

// why: component reads loader data for currency formatting and display
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");

  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: vi.fn(),
  };
});

const useLoaderDataMock = vi.mocked(useLoaderData);

/** Renders the card with the given valuation in the given currency. */
function renderCard(totalValuation: number, currency: Currency = "USD") {
  useLoaderDataMock.mockReturnValue({
    totalAssets: 3,
    valueKnownAssets: 2,
    totalValuation,
    currency,
    locale: "en-US",
  } as unknown as ReturnType<typeof useLoaderData>);

  render(
    <MemoryRouter>
      <InventoryValueChart />
    </MemoryRouter>
  );
}

describe("InventoryValueChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lays out from the card's own width, not the viewport", () => {
    renderCard(3267489.1, "NOK");

    const layout = screen.getByTestId("inventory-value-layout");

    expect(layout.parentElement).toHaveClass("[container-type:inline-size]");
    expect(layout).toHaveClass("flex-col");
    expect(layout).toHaveClass("[@container(min-width:36rem)]:flex-row");
    expect(layout).not.toHaveClass("md:flex-row");
  });

  it("keeps a huge value on one line and sizes it to fit its box", () => {
    const value = 123456789012345.67;
    renderCard(value, "IDR");

    const expected = formatCurrency({
      value,
      currency: "IDR",
      locale: "en-US",
    });
    const valueElement = screen.getByTestId("inventory-value-amount");

    // Intl puts a non-breaking space after the currency code
    const normalize = (text: string | null) => text?.replace(/\s/g, " ");
    expect(normalize(valueElement.textContent)).toBe(normalize(expected));

    expect(valueElement).toHaveClass("whitespace-nowrap");
    expect(valueElement.style.getPropertyValue("--value-font-size")).toBe(
      getFittedValueFontSize(expected)
    );
  });
});

describe("getFittedValueFontSize", () => {
  it("shrinks the font as the value gets longer", () => {
    expect(getFittedValueFontSize("$10.00")).toBe(
      "min(1.875rem, calc(100cqi / 3.72))"
    );
    expect(getFittedValueFontSize("NOK 3,267,489,123,456.10")).toBe(
      "min(1.875rem, calc(100cqi / 14.88))"
    );
  });
});
