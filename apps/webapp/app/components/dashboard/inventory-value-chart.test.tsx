import { render, screen } from "@testing-library/react";
import { useLoaderData } from "react-router";
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
      assets: [
        { id: "asset-1", valuation: 1000 },
        { id: "asset-2", valuation: 5000 },
        { id: "asset-3", valuation: null },
      ],
      totalAssets: 3,
      totalValuation: 123456789012.34,
      currency: "USD",
      locale: "en-US",
    } as unknown;

    useLoaderDataMock.mockReturnValue(loaderData as any);

    render(<InventoryValueChart />);

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
    expect(valueElement).toHaveClass("break-words");
  });
});
