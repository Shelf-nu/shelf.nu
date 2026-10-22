/**
 * ColorBadgePreview unit tests.
 *
 * Pins that the preview shows the badge as categories and tags draw it (the
 * picked color tinted, never as-is), falls back to a placeholder name, and
 * explains the tint only while a color is set. Also pins the preview state
 * hook: it follows the loaded record and color, and keeps what was typed when
 * neither changes.
 *
 * @see {@link file://./color-badge-preview.tsx}
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ColorBadgePreview, useColorBadgePreview } from "./color-badge-preview";

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

  it("shows the plain gray badge and no tint explanation when there is no color", () => {
    render(<ColorBadgePreview name="Spare" color={null} />);
    expect(screen.getByText("Spare")).not.toHaveAttribute("style");
    expect(screen.queryByText(/light tint of your color/)).toBeNull();
  });
});

describe("useColorBadgePreview", () => {
  type Props = { entityId: string; name: string; color: string | null };
  const start: Props = { entityId: "cat-a", name: "Laptops", color: "#ba2e66" };
  const renderPreview = () =>
    renderHook((props: Props) => useColorBadgePreview(props), {
      initialProps: start,
    });

  it("starts from the loaded name and color", () => {
    const { result } = renderPreview();
    expect(result.current.previewName).toBe("Laptops");
    expect(result.current.previewColor).toBe("#ba2e66");
  });

  it("keeps typed values while the loaded record and color stay the same", () => {
    const { result, rerender } = renderPreview();
    act(() => {
      result.current.setPreviewName("Notebooks");
      result.current.setPreviewColor("#12b76a");
    });
    rerender({ ...start });
    expect(result.current.previewName).toBe("Notebooks");
    expect(result.current.previewColor).toBe("#12b76a");
  });

  it("follows a new loaded color and keeps the typed name", () => {
    const { result, rerender } = renderPreview();
    act(() => result.current.setPreviewName("Notebooks"));
    rerender({ ...start, color: "#2e90fa" });
    expect(result.current.previewColor).toBe("#2e90fa");
    expect(result.current.previewName).toBe("Notebooks");
  });

  it("resets name and color when another record loads", () => {
    const { result, rerender } = renderPreview();
    act(() => result.current.setPreviewName("Notebooks"));
    rerender({ entityId: "cat-b", name: "Cameras", color: null });
    expect(result.current.previewName).toBe("Cameras");
    expect(result.current.previewColor).toBeNull();
  });
});
