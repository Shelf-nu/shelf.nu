/**
 * TargetSelect: the per-row destination picker of the import mapping review.
 *
 * Pins the keyboard flow a user relies on: arrows move the highlight, Enter
 * picks the highlighted field, typing filters the list from its top, and
 * reopening the picker starts again with an empty search at the first field.
 *
 * @see {@link file://./target-select.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_FIELDS } from "~/modules/import-mapping/fields";
import { TargetSelect } from "./target-select";

/** Renders the picker for a skipped column and returns its change handler. */
function renderPicker() {
  const onChange = vi.fn();
  render(
    <TargetSelect
      id="row-0"
      source="Legacy ID"
      value={{ kind: "skip" }}
      onChange={onChange}
      canUseBarcodes={false}
    />
  );
  return { onChange };
}

/** The trigger button of the picker. */
const trigger = () =>
  screen.getByRole("button", {
    name: "Shelf field for column Legacy ID: Skip",
  });

describe("TargetSelect", () => {
  it("picks the field the arrow keys highlight", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(trigger());

    await user.type(
      screen.getByRole("textbox", { name: "Search Shelf fields" }),
      "{ArrowDown}{Enter}"
    );

    expect(onChange).toHaveBeenCalledWith({
      kind: "field",
      name: IMPORT_FIELDS[1].name,
    });
  });

  it("starts a search from the top of the filtered list", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(trigger());
    const search = screen.getByRole("textbox", { name: "Search Shelf fields" });

    await user.type(search, "{ArrowDown}{ArrowDown}");
    await user.type(search, "Location{Enter}");

    expect(onChange).toHaveBeenCalledWith({ kind: "field", name: "location" });
  });

  it("reopens with an empty search and the first field highlighted", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    await user.click(trigger());
    await user.type(
      screen.getByRole("textbox", { name: "Search Shelf fields" }),
      "Loc{ArrowDown}"
    );
    await user.keyboard("{Escape}");

    await user.click(trigger());
    const search = screen.getByRole("textbox", { name: "Search Shelf fields" });
    expect(search).toHaveValue("");
    await user.type(search, "{Enter}");

    expect(onChange).toHaveBeenCalledWith({
      kind: "field",
      name: IMPORT_FIELDS[0].name,
    });
  });
});
