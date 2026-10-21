/**
 * The advanced filter's value picker for a custom field dropdown.
 *
 * Options keep the field's saved order. A list longer than eight gets a search
 * box that narrows by text, and the keyboard keeps working on what is left.
 *
 * @see {@link file://./value-field.tsx}
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Filter } from "./schema";
import { ValueField } from "./value-field";

const BRANDS = [
  "Sony",
  "Canon",
  "ARRI",
  "Blackmagic Design",
  "RED",
  "Panasonic",
  "Nikon",
  "Fujifilm",
];

function renderPicker(options: string[]) {
  const setFilter = vi.fn();
  const filter: Filter = {
    name: "cf_Brand",
    type: "enum",
    operator: "is",
    value: options[0],
  };
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <ValueField
          filter={filter}
          setFilter={setFilter}
          applyFilters={vi.fn()}
          fieldName="value"
        />
      ),
      loader: () => ({ customFields: [{ name: "Brand", options }] }),
    },
  ]);
  render(<Stub />);
  return setFilter;
}

describe("ValueField for a custom field dropdown", () => {
  it("lists eight options in saved order with no search box", async () => {
    const user = userEvent.setup();
    renderPicker(BRANDS);

    await user.click(await screen.findByRole("button", { name: "Sony" }));

    expect(
      screen.queryByRole("textbox", { name: "Search options" })
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.id.startsWith("enum-option-"))
        .map((button) => button.textContent)
    ).toEqual(BRANDS);
  });

  it("narrows a longer list by search and picks the highlighted match with Enter", async () => {
    const user = userEvent.setup();
    const setFilter = renderPicker([...BRANDS, "Canon EOS"]);

    await user.click(await screen.findByRole("button", { name: "Sony" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search options" }),
      "can"
    );

    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.id.startsWith("enum-option-"))
        .map((button) => button.textContent)
    ).toEqual(["Canon", "Canon EOS"]);

    await user.keyboard("{ArrowDown}{Enter}");
    expect(setFilter).toHaveBeenLastCalledWith("Canon EOS");
  });

  it("picks only the focused option when Enter is pressed on it", async () => {
    const user = userEvent.setup();
    const setFilter = renderPicker(BRANDS);

    await user.click(await screen.findByRole("button", { name: "Sony" }));
    const arri = screen
      .getAllByRole("button")
      .find((button) => button.textContent === "ARRI");
    arri?.focus();
    await user.keyboard("{Enter}");

    expect(setFilter).toHaveBeenCalledTimes(1);
    expect(setFilter).toHaveBeenCalledWith("ARRI");
  });
});
