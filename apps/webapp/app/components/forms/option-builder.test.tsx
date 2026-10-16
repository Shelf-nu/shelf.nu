/**
 * The option builder in Settings > Custom fields.
 *
 * Typed text is normalised on entry, because that is the only place that
 * touches an option BEFORE anything stores it. Edits to saved options reach the
 * server as the hidden `options` and `optionRenames` inputs the builder renders,
 * which is what the form posts and what these tests read back.
 *
 * @see {@link file://./option-builder.tsx}
 */
import { useReducer } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  createOptionListState,
  optionListReducer,
} from "~/modules/custom-field/option-list";
import OptionBuilder, { resolveOptionEntry } from "./option-builder";

describe("resolveOptionEntry", () => {
  it("adds a plain option", () => {
    expect(resolveOptionEntry("Large", [])).toEqual({
      status: "add",
      option: "Large",
    });
  });

  it("trims what it adds", () => {
    expect(resolveOptionEntry("  Large  ", [])).toEqual({
      status: "add",
      option: "Large",
    });
  });

  it("ignores a blank entry", () => {
    expect(resolveOptionEntry("   ", [])).toEqual({ status: "ignore" });
    expect(resolveOptionEntry("", [])).toEqual({ status: "ignore" });
  });

  it("rejects an exact duplicate", () => {
    expect(resolveOptionEntry("Large", ["Large"])).toEqual({
      status: "duplicate",
    });
  });

  it("rejects a duplicate that differs only by surrounding space", () => {
    // Comparing raw strings would let both through, and they render as two
    // dropdown rows an operator cannot tell apart.
    expect(resolveOptionEntry("Large", [" Large "])).toEqual({
      status: "duplicate",
    });
    expect(resolveOptionEntry(" Large ", ["Large"])).toEqual({
      status: "duplicate",
    });
  });

  it("rejects a duplicate that differs only by case or inner spaces", () => {
    expect(resolveOptionEntry("sony", ["Sony"])).toEqual({
      status: "duplicate",
    });
    expect(
      resolveOptionEntry("Blackmagic  design", ["Blackmagic Design"])
    ).toEqual({ status: "duplicate" });
  });

  it("treats options differing in inner text as distinct", () => {
    expect(resolveOptionEntry("Large box", ["Large"])).toEqual({
      status: "add",
      option: "Large box",
    });
  });
});

describe("OptionBuilder", () => {
  function renderBuilder(
    savedOptions: string[],
    usageCounts?: Record<string, number>
  ) {
    function Harness() {
      const [state, dispatch] = useReducer(
        optionListReducer,
        savedOptions,
        createOptionListState
      );
      return (
        <form>
          <OptionBuilder
            state={state}
            dispatch={dispatch}
            usageCounts={usageCounts}
            optionName={(i) => `options[${i}]`}
            renameName={(i, side) => `optionRenames[${i}].${side}`}
          />
        </form>
      );
    }
    const { container } = render(<Harness />);
    const form = container.querySelector("form") as HTMLFormElement;
    return () => [...new FormData(form).entries()];
  }

  it("posts the merged and renamed options with the renames that move their assets", async () => {
    const user = userEvent.setup();
    const posted = renderBuilder(["Sony ", "Canon", "sony"], {
      "Sony ": 3,
      sony: 2,
      Canon: 5,
    });

    expect(
      screen.getByText("1 option is a duplicate of another")
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Merge duplicates" }));
    await user.click(screen.getByRole("button", { name: "Rename Sony" }));
    await user.clear(screen.getByRole("textbox", { name: "Rename Sony" }));
    await user.type(
      screen.getByRole("textbox", { name: "Rename Sony" }),
      "Sony{Enter}"
    );

    expect(
      screen.getByText("Used on 5 assets. 5 will be updated on save")
    ).toBeInTheDocument();
    expect(posted()).toEqual([
      ["options[0]", "Sony"],
      ["options[1]", "Canon"],
      ["optionRenames[0].from", "Sony "],
      ["optionRenames[0].to", "Sony"],
      ["optionRenames[1].from", "sony"],
      ["optionRenames[1].to", "Sony"],
    ]);
  });

  it("refuses a rename another option already reads as", async () => {
    const user = userEvent.setup();
    const posted = renderBuilder(["Sony", "Canon"]);

    await user.click(screen.getByRole("button", { name: "Rename Sony" }));
    await user.type(
      screen.getByRole("textbox", { name: "Rename Sony" }),
      "{Control>}a{/Control} canon {Enter}"
    );

    expect(screen.getByText("Option already exists")).toBeInTheDocument();
    expect(posted()).toEqual([
      ["options[0]", "Sony"],
      ["options[1]", "Canon"],
    ]);
  });

  it("sorts A-Z and undoes the sort", async () => {
    const user = userEvent.setup();
    const posted = renderBuilder(["Medium", "Large", "Small"]);

    await user.click(screen.getByRole("button", { name: "Sort A-Z" }));
    expect(posted()).toEqual([
      ["options[0]", "Large"],
      ["options[1]", "Medium"],
      ["options[2]", "Small"],
    ]);

    await user.click(screen.getByRole("button", { name: "Undo sort" }));
    expect(posted()).toEqual([
      ["options[0]", "Medium"],
      ["options[1]", "Large"],
      ["options[2]", "Small"],
    ]);
  });

  it("asks before removing an option that assets use, naming how many", async () => {
    const user = userEvent.setup();
    const posted = renderBuilder(["Sony", "Canon"], { Sony: 4 });

    await user.click(screen.getByRole("button", { name: "Remove Canon" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Sony" }));
    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText(/It is used on 4 assets\./)
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Remove option" })
    );

    expect(posted()).toEqual([]);
  });
});
