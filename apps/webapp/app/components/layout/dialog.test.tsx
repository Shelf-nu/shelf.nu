/**
 * Dialog — unit tests
 *
 * Pins two things that nothing else can catch.
 *
 * The DOM contract: `global.css` styles this dialog through the BARE `dialog`
 * element selector and positions it as a flex child of `.dialog-backdrop`.
 * Neither typecheck nor a render assertion on content would notice the element
 * becoming a `div` or leaving the backdrop, and the test environment applies no
 * CSS — so the structure itself is asserted as a proxy for "the styles still
 * attach".
 *
 * The Escape listener's target: it must be `window`, in the capture phase. The
 * capture phase runs window -> document, so a `window` listener fires before an
 * enclosing overlay's document-level handler and can stop the key reaching it.
 * On `document` the outer layer wins and a dialog opened inside a Sheet closes
 * the Sheet instead of itself.
 *
 * @see {@link file://./dialog.tsx}
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vitest, afterEach } from "vitest";
import { Dialog } from "./dialog";

function renderDialog(onClose = vitest.fn()) {
  const utils = render(
    <Dialog title="Test dialog" open onClose={onClose}>
      <button type="button">inside</button>
    </Dialog>
  );
  return { onClose, ...utils };
}

afterEach(() => {
  vitest.restoreAllMocks();
});

describe("Dialog DOM contract", () => {
  it("renders a real <dialog> element inside the backdrop", () => {
    const { container } = renderDialog();

    const backdrop = container.querySelector(".dialog-backdrop");
    expect(backdrop).toBeTruthy();

    // A `div` here would silently drop every rule the bare `dialog` selector
    // applies: full-screen on mobile, 600px centred on desktop, safe-area pad.
    const dialog = backdrop!.querySelector("dialog.dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.tagName).toBe("DIALOG");
  });

  it("keeps the header and body regions the stylesheet targets", () => {
    const { container } = renderDialog();

    expect(container.querySelector(".dialog-header")).toBeTruthy();
    expect(container.querySelector(".dialog-body")).toBeTruthy();
  });
});

describe("Dialog dismissal", () => {
  it("registers its Escape listener on window, in the capture phase", () => {
    // why: spying on the registration is the only way to pin the target. The
    // behavioural difference only shows up nested inside another overlay,
    // which needs a real browser.
    const addSpy = vitest.spyOn(window, "addEventListener");

    renderDialog();

    const keydown = addSpy.mock.calls.find(([type]) => type === "keydown");
    expect(keydown).toBeTruthy();
    expect(keydown![2]).toMatchObject({ capture: true });
  });

  it("closes on Escape", () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("leaves Escape to an open Radix layer the keystroke came from", () => {
    // why: Radix portals popover and select content into a
    // `[data-radix-popper-content-wrapper]` on body and closes it from its own
    // document-level handler. This listener runs first, so closing
    // unconditionally would shut the whole dialog the moment someone dismissed
    // a picker inside it, losing the form. Escape peels one layer at a time.
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="t">
        body
      </Dialog>
    );

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-radix-popper-content-wrapper", "");
    const inside = document.createElement("input");
    wrapper.appendChild(inside);
    document.body.appendChild(wrapper);

    fireEvent.keyDown(inside, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();

    // why: an open layer elsewhere must not hold the dialog open, so a
    // keystroke from outside any popper still closes it.
    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);

    wrapper.remove();
  });

  it("closes when the backdrop itself is clicked", () => {
    const { onClose, container } = renderDialog();

    fireEvent.click(container.querySelector(".dialog-backdrop")!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not close when the click lands on content inside the dialog", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "inside" }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the header close control", () => {
    const { onClose } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
