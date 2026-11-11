/**
 * Scrolling of the "From location" / "At location" picker's option list.
 *
 * The list is portalled to `document.body`. A modal dialog around the picker
 * (the check-out confirmation, the custody dialogs) cancels `wheel` and
 * `touchmove` events that reach `document` from outside its content, so the
 * list must keep them from getting there, or a long list cannot be scrolled.
 *
 * @see {@link file://./source-location-picker.tsx}
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SourceLocationPicker } from "./source-location-picker";

const OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: `loc-${index}`,
  label: `Location ${index} · 5 pcs`,
}));

/** What a modal dialog's scroll lock sees: events that reach `document`. */
const reachedDocument = vi.fn();

afterEach(() => {
  document.removeEventListener("wheel", reachedDocument);
  document.removeEventListener("touchmove", reachedDocument);
  reachedDocument.mockClear();
});

describe("SourceLocationPicker list scrolling", () => {
  it.each(["wheel", "touchmove"] as const)(
    "keeps %s events on the open list from reaching the document",
    (type) => {
      render(
        <SourceLocationPicker
          id="source"
          options={OPTIONS}
          value="loc-0"
          onChange={() => {}}
          listLabel="From location"
          triggerAriaLabel="From location"
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "From location" }));
      document.addEventListener(type, reachedDocument);

      const option = screen.getByRole("option", { name: "Location 6 · 5 pcs" });
      if (type === "wheel") fireEvent.wheel(option, { deltaY: 120 });
      else fireEvent.touchMove(option);

      expect(reachedDocument).not.toHaveBeenCalled();
    }
  );
});
