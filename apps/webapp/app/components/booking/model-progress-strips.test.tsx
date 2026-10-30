/**
 * Tests for {@link ModelProgressStrips}, the foldable per-model progress shown
 * above both booking scanners.
 *
 * The fold control sits next to the scanner's code field. A hardware scanner
 * types into whatever has focus and ends each code with Enter, so a click on
 * the control must leave focus in the code field: otherwise the next scan is
 * swallowed by the button and its Enter folds the list.
 *
 * @see {@link file://./model-progress-strips.tsx}
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModelProgress } from "./model-pending-rows";
import { ModelProgressStrips } from "./model-progress-strips";

/** Two reserved models, nothing scanned yet. */
const progress: ModelProgress[] = [
  {
    assetModelId: "model-camera",
    assetModelName: "Camera",
    booked: 4,
    remaining: 4,
    prefulfilled: 0,
    matched: 0,
  },
  {
    assetModelId: "model-tripod",
    assetModelName: "Tripod",
    booked: 2,
    remaining: 2,
    prefulfilled: 0,
    matched: 0,
  },
];

/** The fold control, found by its summary text. */
const foldControl = () =>
  screen.getByRole("button", { name: /2 models reserved/ });

describe("ModelProgressStrips", () => {
  it("does not take focus on a mouse press, so the scan field keeps it", () => {
    render(
      <>
        <input aria-label="Scan code" />
        <ModelProgressStrips progressByModel={progress} idPrefix="test" />
      </>
    );
    const scanField = screen.getByLabelText("Scan code");
    scanField.focus();

    // `false` means the press's default action, moving focus, was cancelled.
    expect(fireEvent.mouseDown(foldControl())).toBe(false);
    fireEvent.click(foldControl());

    expect(document.activeElement).toBe(scanField);
    expect(foldControl()).toHaveAttribute("aria-expanded", "true");
  });

  it("still opens and folds the list on click", () => {
    render(<ModelProgressStrips progressByModel={progress} idPrefix="test" />);

    expect(document.getElementById("test-model-progress-list")).toBeNull();

    fireEvent.click(foldControl());
    expect(document.getElementById("test-model-progress-list")).not.toBeNull();
    expect(screen.getByText("Camera")).toBeInTheDocument();

    fireEvent.click(foldControl());
    expect(document.getElementById("test-model-progress-list")).toBeNull();
  });
});
