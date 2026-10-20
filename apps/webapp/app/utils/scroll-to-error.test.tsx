/**
 * Tests for scrollToFirstErrorOnNextFrame, wired the way the asset form wires
 * it: called from `onSubmit` when Zorm has cancelled the submit.
 *
 * Runs against the real `useZorm`, because the behavior depends on two facts
 * about it: its submit listener cancels the event before React's `onSubmit`
 * runs, and after the first submit it re-validates on every `change` event.
 */
import { useState } from "react";
import { fireEvent, render } from "@testing-library/react";
import { useZorm } from "react-zorm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { scrollToFirstErrorOnNextFrame } from "./scroll-to-error";

const schema = z.object({
  title: z.string().min(1, "Title is required"),
  notes: z.string().optional(),
});

/**
 * Mirrors the asset form's submit handler: its own checks may cancel a submit
 * Zorm accepted, and one check at the end scrolls for every cancellation.
 *
 * @param props.localError - Message the form's own check raises on submit
 */
function TestForm({ localError }: { localError?: string }) {
  const zo = useZorm("TestForm", schema);
  const [shownLocalError, setShownLocalError] = useState<string>();
  return (
    <form
      ref={zo.ref}
      onSubmit={(e) => {
        if (localError) {
          setShownLocalError(localError);
          e.preventDefault();
        }
        if (e.defaultPrevented) {
          scrollToFirstErrorOnNextFrame(e.currentTarget);
        }
      }}
    >
      <input data-testid="title" name={zo.fields.title()} />
      {zo.errors.title((e) => (
        <div className="text-sm text-error-500">{e.message}</div>
      ))}
      <input data-testid="notes" name={zo.fields.notes()} />
      {shownLocalError ? (
        <p className="text-sm text-error-500">{shownLocalError}</p>
      ) : null}
    </form>
  );
}

/** Resolves after the frame the helper scheduled its lookup in. */
const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("scrollToFirstErrorOnNextFrame", () => {
  const scrollIntoView = vi.fn();
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    // why: happy-dom has no layout, so the scroll itself is the observable outcome
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = original;
    scrollIntoView.mockReset();
  });

  it("scrolls the first error message into view when a submit fails", async () => {
    const { container } = render(<TestForm />);

    fireEvent.submit(container.querySelector("form")!);
    await nextFrame();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toHaveTextContent(
      "Title is required"
    );
  });

  it("does not scroll again when another field changes after a failed submit", async () => {
    const { container, getByTestId } = render(<TestForm />);

    fireEvent.submit(container.querySelector("form")!);
    await nextFrame();
    fireEvent.change(getByTestId("notes"), { target: { value: "x" } });
    await nextFrame();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls when the form's own check rejects a submit Zorm accepted", async () => {
    const { container, getByTestId } = render(
      <TestForm localError="Please select a consumption type" />
    );

    fireEvent.change(getByTestId("title"), { target: { value: "Drill" } });
    fireEvent.submit(container.querySelector("form")!);
    await nextFrame();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toHaveTextContent(
      "Please select a consumption type"
    );
  });

  it("does not scroll when the submit passes validation", async () => {
    const { container, getByTestId } = render(<TestForm />);

    fireEvent.change(getByTestId("title"), { target: { value: "Drill" } });
    fireEvent.submit(container.querySelector("form")!);
    await nextFrame();

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
