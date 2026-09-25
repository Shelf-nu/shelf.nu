/**
 * Keyboard behaviour of the "From location" / "At location" picker.
 *
 * One key press must make exactly one choice, and it must be the option the
 * operator can see as highlighted: the one with keyboard focus. The picker
 * posts the choice as the custody's source location, so picking a different
 * option than the focused one records the wrong location.
 *
 * @see {@link file://./custody-source-select.tsx}
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CustodySourceOption } from "~/modules/asset/custody-source";
import { CustodySourceSelect } from "./custody-source-select";

const option = (
  value: string,
  label: string,
  left: number
): CustodySourceOption => ({
  value,
  locationId: value,
  label,
  placed: left,
  inCustody: 0,
  left,
});

const OPTIONS = [
  option("loc-camera", "Camera Room", 2),
  option("loc-studio", "Studio", 3),
  option("loc-store", "Store", 1),
];

function renderPicker() {
  const onChange = vi.fn();
  render(
    <CustodySourceSelect
      id="source"
      label="From location"
      options={OPTIONS}
      value="loc-studio"
      onChange={onChange}
      unitLabel="pcs"
    />
  );
  return onChange;
}

const optionNamed = (name: RegExp) => screen.getByRole("option", { name });

describe("CustodySourceSelect keyboard", () => {
  it("opens on the selected option and picks the next one with ArrowDown + Enter", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByRole("button", { name: /From location/ }));
    expect(optionNamed(/^Studio/)).toHaveFocus();

    await user.keyboard("{ArrowDown}{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("loc-store");
  });

  it("picks the focused option once, even when another one was highlighted", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByRole("button", { name: /From location/ }));
    // Focus moves to Camera Room without the arrow keys (e.g. Shift+Tab).
    optionNamed(/^Camera Room/).focus();
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("loc-camera");
  });

  it("moves focus with the pointer, so the keys act on the hovered option", async () => {
    const user = userEvent.setup();
    const onChange = renderPicker();

    await user.click(screen.getByRole("button", { name: /From location/ }));
    await user.hover(optionNamed(/^Camera Room/));
    expect(optionNamed(/^Camera Room/)).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(optionNamed(/^Studio/)).toHaveFocus();

    await user.hover(optionNamed(/^Store/));
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("loc-store");
  });
});
