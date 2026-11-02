/**
 * Pins the shared drag-to-reorder primitives: the handle is the only place a
 * drag starts, it forwards keyboard moves, it carries the accessible name and
 * instructions, and the hint always names the keyboard shortcut.
 *
 * @see {@link file://./../../../app/components/shared/reorder-handle.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { DragControls } from "framer-motion";
import { describe, expect, it, vi } from "vitest";
import { ReorderHandle, ReorderHint } from "~/components/shared/reorder-handle";

function renderHandle() {
  // why: real DragControls need layout measurement happy-dom does not provide;
  // the handle only has to hand its pointer event to `start`.
  const dragControls = { start: vi.fn() } as unknown as DragControls;
  const onKeyDown = vi.fn();
  render(
    <>
      <p id="instructions">Press Alt plus Arrow Up</p>
      <ReorderHandle
        dragControls={dragControls}
        label="Name"
        onKeyDown={onKeyDown}
        describedById="instructions"
      />
    </>
  );
  return {
    handle: screen.getByRole("button", { name: "Reorder Name" }),
    dragControls,
    onKeyDown,
  };
}

describe("ReorderHandle", () => {
  it("starts a drag from pointer-down", () => {
    const { handle, dragControls } = renderHandle();
    fireEvent.pointerDown(handle);
    expect(dragControls.start).toHaveBeenCalledTimes(1);
  });

  it("forwards key presses to onKeyDown", () => {
    const { handle, onKeyDown } = renderHandle();
    fireEvent.keyDown(handle, { key: "ArrowDown", altKey: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("is described by the keyboard instructions and names the shortcut", () => {
    const { handle } = renderHandle();
    expect(handle).toHaveAttribute("type", "button");
    expect(handle).toHaveAccessibleDescription("Press Alt plus Arrow Up");
    expect(handle).toHaveAttribute(
      "aria-keyshortcuts",
      "Alt+ArrowUp Alt+ArrowDown"
    );
    expect(handle.getAttribute("title")).toMatch(/Alt\+Arrow/);
  });
});

describe("ReorderHint", () => {
  it("always shows the keyboard shortcut", () => {
    render(<ReorderHint />);
    expect(screen.getByText("Drag or Alt + ↑ / ↓ to reorder")).toBeVisible();
  });
});
