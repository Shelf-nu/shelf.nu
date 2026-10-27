/**
 * The advanced filter's operator picker.
 *
 * Arrow keys move the highlight and focus together, so Enter or Space picks
 * the highlighted operator, exactly once.
 *
 * @see {@link file://./operator-selector.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OperatorSelector } from "./operator-selector";

function renderOperatorPicker() {
  const setFilter = vi.fn();
  render(
    <OperatorSelector
      filter={{
        name: "createdAt",
        type: "date",
        operator: "is",
        value: "",
      }}
      setFilter={setFilter}
    />
  );
  return setFilter;
}

describe("OperatorSelector", () => {
  it("picks the operator highlighted with the arrow keys, once", async () => {
    const user = userEvent.setup();
    const setFilter = renderOperatorPicker();

    await user.click(screen.getByRole("button"));
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(document.activeElement?.id).toBe("operator-option-1");

    await user.keyboard("{Enter}");
    expect(setFilter).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenCalledWith("isNot");
  });

  it("picks only the focused operator when Space is pressed on it", async () => {
    const user = userEvent.setup();
    const setFilter = renderOperatorPicker();

    await user.click(screen.getByRole("button"));
    await user.tab();
    await user.tab();
    await user.keyboard(" ");

    expect(setFilter).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenCalledWith("before");
  });
});
