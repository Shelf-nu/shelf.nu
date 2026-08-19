import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

const REASON = /only the owner can do this/i;

/**
 * The reason lives in the DOM twice on purpose:
 *
 * 1. a visually hidden copy that `aria-describedby` resolves against — it must
 *    exist even while the card is closed, or a screen-reader user gets nothing
 * 2. the hover card content itself, mounted only while open
 *
 * So "the popup is open" is `2` occurrences, and "closed" is `1`.
 */
function reasonOccurrences() {
  return screen.queryAllByText(REASON).length;
}

function renderDisabledButton() {
  render(
    <Button type="button" disabled={{ reason: "Only the owner can do this." }}>
      Transfer ownership
    </Button>
  );

  return screen.getByRole("button", { name: /transfer ownership/i });
}

/**
 * Disabled-with-reason buttons explain themselves through a HoverCard.
 * Hover never fires on touch devices, so the reason must ALSO open on
 * click/tap — otherwise mobile users get a dead-looking grey button.
 */
describe("Button disabled with reason", () => {
  // why: fireEvent instead of userEvent — userEvent simulates the full pointer
  // sequence including hover, which would open the popup via the hover path and
  // hide a broken click path. These tests drive the pointer events explicitly.
  it("reveals the reason on click, not only on hover", () => {
    const button = renderDisabledButton();

    expect(reasonOccurrences()).toBe(1);

    // No native `disabled` attribute (it would swallow the pointer events the
    // popup needs), so the state must be exposed to assistive tech instead.
    expect(button).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(button);

    expect(reasonOccurrences()).toBe(2);
  });

  /**
   * The mouse sequence is `pointerdown` → `click`, and Radix's DismissableLayer
   * closes the card on that `pointerdown`. A `!prev` toggle in the click handler
   * therefore reads the already-closed state and re-opens it, so the card could
   * never be closed by clicking. Driving only `click` (as an earlier version of
   * this test did) skips the dismiss entirely and reports a toggle that works.
   *
   * This pins the user-visible outcome — after a full press the reason is on
   * screen. It cannot prove Radix's dismiss ran: happy-dom does not reproduce
   * the layer's pointer plumbing faithfully enough to observe the intermediate
   * state, and both a dismiss-then-open and a never-dismissed card end open.
   */
  it("keeps the reason open across a full mouse press, rather than flickering", () => {
    const button = renderDisabledButton();

    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(reasonOccurrences()).toBe(2);

    // A second full press must not leave the user staring at a button that
    // still explains nothing.
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(reasonOccurrences()).toBe(2);
  });

  it("points assistive tech at the reason via aria-describedby", () => {
    const button = renderDisabledButton();
    const describedBy = button.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();

    // The description must exist while the card is CLOSED — hover card content
    // is unmounted then, so a screen reader has nothing else to announce.
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      REASON
    );
  });
});
