/**
 * SearchableSelect: the Popover select used by form dialogs.
 *
 * Pins what a form relies on: the chosen value is posted through the hidden
 * input, the search narrows the list, the keyboard picks, and a current value
 * that is not a listed choice still shows on the trigger.
 *
 * @see {@link file://./searchable-select.tsx}
 */
import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SearchableSelectOption } from "./searchable-select";
import { SearchableSelect } from "./searchable-select";

const OPTIONS: SearchableSelectOption[] = [
  { value: "", label: "None" },
  { value: "serial", label: "Serial number", hint: "Text" },
  { value: "owner", label: "Owner", hint: "Option" },
  {
    value: "old",
    label: "Retired field",
    hint: "inactive",
    hiddenFromList: true,
  },
];

/** Renders the select inside a form and returns a reader for the posted value. */
function renderSelect(
  props: Partial<ComponentProps<typeof SearchableSelect>> = {}
) {
  const { container } = render(
    <form>
      <SearchableSelect
        name="slot"
        label="Custom field 1"
        defaultValue=""
        options={OPTIONS}
        {...props}
      />
    </form>
  );
  const form = container.querySelector("form") as HTMLFormElement;
  return { posted: () => new FormData(form).get("slot") };
}

/** The trigger button, found through its visible label. */
const trigger = () => screen.getByRole("button", { name: /Custom field 1/ });

describe("SearchableSelect", () => {
  it("posts the chosen value through the hidden input", async () => {
    const user = userEvent.setup();
    const { posted } = renderSelect();
    expect(posted()).toBe("");

    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: /Owner/ }));

    expect(posted()).toBe("owner");
    expect(trigger()).toHaveTextContent("Owner");
  });

  it("filters the options by the search text", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(trigger());

    await user.type(
      screen.getByRole("combobox", { name: "Search Custom field 1" }),
      "seri"
    );

    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: /Serial number/ })).toBeVisible();
  });

  it("shows the empty message and ignores Enter when nothing matches", async () => {
    const user = userEvent.setup();
    const { posted } = renderSelect({ defaultValue: "serial" });
    await user.click(trigger());

    await user.type(
      screen.getByRole("combobox", { name: "Search Custom field 1" }),
      "zzz{Enter}"
    );

    expect(screen.getByText("No results")).toBeVisible();
    expect(posted()).toBe("serial");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(posted()).toBe("serial");
  });

  it("picks with the keyboard", async () => {
    const user = userEvent.setup();
    const { posted } = renderSelect();
    await user.click(trigger());

    await user.keyboard("{ArrowDown}{Enter}");

    expect(posted()).toBe("serial");
  });

  it("hides the search box when not searchable", async () => {
    const user = userEvent.setup();
    renderSelect({ searchable: false });
    await user.click(trigger());

    expect(screen.getByRole("listbox")).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("shows a hidden-from-list current value on the trigger but not in the list", async () => {
    const user = userEvent.setup();
    const { posted } = renderSelect({ defaultValue: "old" });

    expect(trigger()).toHaveTextContent("Retired field");
    expect(posted()).toBe("old");

    await user.click(trigger());
    expect(
      screen.queryByRole("option", { name: /Retired field/ })
    ).not.toBeInTheDocument();
  });

  it("calls onChange with the picked value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSelect({ onChange });

    await user.click(trigger());
    await user.click(screen.getByRole("option", { name: /Owner/ }));

    expect(onChange).toHaveBeenCalledWith("owner");
  });

  it("posts the first option when the default value is unknown", () => {
    const { posted } = renderSelect({ defaultValue: "missing" });

    expect(posted()).toBe("");
    expect(trigger()).toHaveTextContent("None");
  });

  it("moves aria-activedescendant to the next option on ArrowDown", async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(trigger());
    const search = screen.getByRole("combobox", {
      name: "Search Custom field 1",
    });
    const [first, second] = screen.getAllByRole("option");
    expect(search).toHaveAttribute("aria-activedescendant", first.id);

    await user.keyboard("{ArrowDown}");

    expect(search).toHaveAttribute("aria-activedescendant", second.id);
  });
});
