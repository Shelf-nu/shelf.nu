import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InventoryValueChart from "./inventory-value-chart";

// why: component reads loader data for currency formatting and display
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");

  return {
    ...(actual as Record<string, unknown>),
    useLoaderData: vi.fn(),
  };
});

const useLoaderDataMock = vi.mocked(useLoaderData);

describe("InventoryValueChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stacks the progress circle and metrics responsively to avoid overflow", () => {
    const loaderData = {
      totalAssets: 3,
      valueKnownAssets: 2,
      totalValuation: 123456789012.34,
      currency: "USD",
      locale: "en-US",
    } as unknown;

    useLoaderDataMock.mockReturnValue(loaderData as any);

    render(
      <MemoryRouter>
        <InventoryValueChart />
      </MemoryRouter>
    );

    const layout = screen.getByTestId("inventory-value-layout");

    expect(layout).toHaveClass("flex-col");
    expect(layout).toHaveClass("md:flex-row");

    const expectedValue = (loaderData as any).totalValuation.toLocaleString(
      (loaderData as any).locale,
      {
        style: "currency",
        currency: (loaderData as any).currency,
      }
    );

    const valueElement = screen.getByText(expectedValue);

    expect(valueElement).toBeInTheDocument();
    expect(valueElement).toHaveClass("break-all");
  });
});
