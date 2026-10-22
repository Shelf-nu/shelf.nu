/**
 * ColorBadgePreview unit tests.
 *
 * Pins that the preview shows the badge as categories and tags draw it (the
 * picked color tinted, never as-is), falls back to a placeholder name, and
 * always explains why the badge differs from the picked color.
 *
 * @see {@link file://./color-badge-preview.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ColorBadgePreview } from "./color-badge-preview";

describe("ColorBadgePreview", () => {
  it("shows the typed name as a badge tinted from the color", () => {
    render(<ColorBadgePreview name="Laptops" color="#ba2e66" />);
    const badge = screen.getByText("Laptops");
    // The badge background is the picked color at 20% (hex alpha 33), not the color itself.
    expect(badge).toHaveStyle({ backgroundColor: "#ba2e6633" });
  });

  it("falls back to a placeholder while the name is blank", () => {
    render(<ColorBadgePreview name="   " color="#ba2e66" />);
    expect(screen.getByText("Untitled")).toBeInTheDocument();
  });

  it("explains why the badge differs from the picked color", () => {
    render(<ColorBadgePreview name="Laptops" color="#ba2e66" />);
    expect(
      screen.getByText(/light tint of your color with darker text/)
    ).toBeInTheDocument();
  });

  it("shows the plain gray badge when there is no color", () => {
    render(<ColorBadgePreview name="Spare" color={null} />);
    expect(screen.getByText("Spare")).not.toHaveAttribute("style");
  });
});
