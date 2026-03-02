import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyTableValue } from "./empty-table-value";

describe("EmptyTableValue", () => {
  it("renders placeholder with default accessibility labels", () => {
    render(<EmptyTableValue />);

    const placeholder = screen.getByLabelText("No data");
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveTextContent("—");
  });

  it("renders with custom label", () => {
    render(<EmptyTableValue label="Empty field" />);

    const placeholder = screen.getByLabelText("Empty field");
    expect(placeholder).toBeInTheDocument();
  });

  it("renders with custom symbol", () => {
    render(<EmptyTableValue symbol="N/A" />);

    const placeholder = screen.getByLabelText("No data");
    expect(placeholder).toHaveTextContent("N/A");
  });

  it("renders with both custom label and symbol", () => {
    render(<EmptyTableValue label="Not available" symbol="—" />);

    const placeholder = screen.getByLabelText("Not available");
    expect(placeholder).toHaveTextContent("—");
  });

  it("applies custom className", () => {
    render(<EmptyTableValue className="custom-class" />);

    const placeholder = screen.getByLabelText("No data");
    expect(placeholder).toHaveClass("custom-class");
  });

  it("has correct accessibility structure", () => {
    render(<EmptyTableValue />);

    const placeholder = screen.getByLabelText("No data");

    // Visual symbol should be hidden from screen readers
    const visualSymbol = placeholder.querySelector('[aria-hidden="true"]');
    expect(visualSymbol).toBeInTheDocument();
    expect(visualSymbol).toHaveTextContent("—");

    // Screen reader text should be present but visually hidden
    const srText = placeholder.querySelector(".sr-only");
    expect(srText).toBeInTheDocument();
    expect(srText).toHaveTextContent("No data");
  });
});
