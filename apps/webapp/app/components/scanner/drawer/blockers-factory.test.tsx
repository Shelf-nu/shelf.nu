/**
 * Tests for {@link createBlockers}.
 *
 * The blocker panel renders inside the scanner drawer's pinned footer, which
 * does not shrink — so every pixel it takes comes out of the action button
 * below it. Drawers declare up to nine blocker categories and the drawer itself
 * is only `viewport - 400` tall in scanner mode, so an uncapped list can push
 * its own "confirm" button past the bottom of a `fixed` box with no scroll path
 * back to it.
 *
 * happy-dom does no layout, so these pin the structure that bounds the panel:
 * the list scrolls within a cap, and the count and escape hatch stay outside
 * that cap so they are legible however long the list runs.
 *
 * @see {@link file://./blockers-factory.tsx}
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createBlockers, type BlockerConfig } from "./blockers-factory";

/** `count` active blocker categories, each carrying a description line. */
function makeBlockers(count: number): BlockerConfig[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `blocker-${i}`,
    condition: true,
    count: i + 1,
    message: (n: number) => `${n} item(s) hit blocker ${i}`,
    description: `Why blocker ${i} happens`,
    onResolve: vi.fn(),
  }));
}

/** Renders the component half of the factory tuple. */
function renderBlockers(configs: BlockerConfig[]) {
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs: configs,
    onResolveAll: vi.fn(),
  });
  const result = render(<Blockers />);
  return { hasBlockers, ...result };
}

describe("createBlockers", () => {
  it("caps the blocker list so it cannot displace the drawer's action", () => {
    // Nine categories is what partial-check-in actually declares.
    renderBlockers(makeBlockers(9));

    const list = screen.getByRole("list");

    expect(list.className).toContain("overflow-y-auto");
    // Viewport-relative on purpose: a fixed pixel cap that fits a laptop still
    // buries the button on a phone, where the drawer is a few hundred px tall.
    expect(list.className).toContain("max-h-[20vh]");
  });

  it("keeps the count and the escape hatch outside the scrolling area", () => {
    // Scrolling the list must never hide how many blockers there are or the
    // one control that clears them.
    renderBlockers(makeBlockers(9));

    const list = screen.getByRole("list");
    const resolveAll = screen.getByRole("button", { name: /Resolve all/ });

    expect(screen.getByText(/Unresolved blockers \(45\)/)).toBeInTheDocument();
    expect(list.contains(resolveAll)).toBe(false);
  });

  it("renders every active blocker, so the cap hides none of them", () => {
    renderBlockers(makeBlockers(9));

    expect(screen.getByRole("list").children).toHaveLength(9);
  });

  it("renders nothing when no blocker is active", () => {
    const { hasBlockers, container } = renderBlockers([
      {
        id: "inactive",
        condition: false,
        count: 0,
        message: () => "never shown",
        onResolve: vi.fn(),
      },
    ]);

    expect(hasBlockers).toBe(false);
    expect(container).toBeEmptyDOMElement();
  });
});
