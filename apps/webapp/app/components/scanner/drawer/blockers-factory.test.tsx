/**
 * Tests for {@link createBlockers}.
 *
 * Blockers render as a "Needs attention" card at the top of the scanner
 * drawer's list, plus a one-line note in the footer that says why the action is
 * disabled when the card has scrolled out of view. Every scanner drawer gets
 * both from this one factory, so these pin what an operator sees in all of
 * them: every active blocker listed with its fix, one control that clears them
 * all, and nothing at all when no blocker is active.
 *
 * @see {@link file://./blockers-factory.tsx}
 * @see {@link file://./configurable-drawer.tsx} places the card and the note
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
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

/** Builds the factory output. */
function build(configs: BlockerConfig[]) {
  const [hasBlockers, Blockers] = createBlockers({ blockerConfigs: configs });
  return { hasBlockers, Blockers };
}

describe("createBlockers", () => {
  it("renders a Needs attention card counting every unresolved item", () => {
    const { Blockers } = build(makeBlockers(3));
    render(<Blockers />);

    const toggle = screen.getByRole("button", { name: /Needs attention/ });
    // 1 + 2 + 3 items across the three categories.
    expect(toggle).toHaveTextContent("6");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("lists every active blocker with its message, fix and explanation", () => {
    const configs = makeBlockers(9);
    const { Blockers } = build(configs);
    render(<Blockers />);

    for (const [i] of configs.entries()) {
      expect(
        screen.getByText(`${i + 1} item(s) hit blocker ${i}`)
      ).toBeInTheDocument();
      expect(screen.getByText(`Why blocker ${i} happens`)).toBeInTheDocument();
    }
    const removes = screen.getAllByRole("button", { name: "Remove from list" });
    expect(removes).toHaveLength(9);

    fireEvent.click(removes[4]);
    expect(configs[4].onResolve).toHaveBeenCalledTimes(1);
  });

  it("offers Resolve all in the card header, outside the fold toggle", () => {
    const { Blockers } = build(makeBlockers(2));
    render(<Blockers />);

    const toggle = screen.getByRole("button", { name: /Needs attention/ });
    const resolveAll = screen.getByRole("button", { name: /Resolve all/ });

    expect(toggle.contains(resolveAll)).toBe(false);
    expect(resolveAll).toHaveTextContent("3");
  });

  it("Resolve all runs every shown blocker's fix and nothing else", () => {
    // A blocker whose condition is false is not shown, so the operator was
    // never told about its rows: Resolve all must not touch them.
    const shown = makeBlockers(2);
    const hidden: BlockerConfig = {
      id: "hidden",
      condition: false,
      count: 1,
      message: () => "never shown",
      onResolve: vi.fn(),
    };
    const { Blockers } = build([...shown, hidden]);
    render(<Blockers />);

    fireEvent.click(screen.getByRole("button", { name: /Resolve all/ }));

    expect(shown[0].onResolve).toHaveBeenCalledTimes(1);
    expect(shown[1].onResolve).toHaveBeenCalledTimes(1);
    expect(hidden.onResolve).not.toHaveBeenCalled();
  });

  it("renders the footer note naming how many issues stand in the way", () => {
    const { Blockers } = build(makeBlockers(2));
    const { container } = render(<Blockers variant="note" />);

    expect(container).toHaveTextContent("Resolve 3 issues above to continue.");
    // The note is text only: the fixes live in the card.
    expect(within(container).queryByRole("button")).toBeNull();
  });

  it("says issue, not issues, for exactly one", () => {
    const { Blockers } = build(makeBlockers(1));
    const { container } = render(<Blockers variant="note" />);

    expect(container).toHaveTextContent("Resolve 1 issue above to continue.");
  });

  it("renders nothing, card or note, when no blocker is active", () => {
    const { hasBlockers, Blockers } = build([
      {
        id: "inactive",
        condition: false,
        count: 0,
        message: () => "never shown",
        onResolve: vi.fn(),
      },
    ]);

    expect(hasBlockers).toBe(false);
    expect(render(<Blockers />).container).toBeEmptyDOMElement();
    expect(render(<Blockers variant="note" />).container).toBeEmptyDOMElement();
  });
});
