/**
 * The typed delete confirmation, on every single-item delete dialog.
 *
 * Each dialog keeps its destructive button disabled until the user types the
 * item's name, accepts it with any case and stray spaces (the shared rule from
 * `@shelf/labels`), and starts empty again when reopened. Category and tag ask
 * only when something uses them; an unused one keeps the one-click confirm.
 *
 * Rendered in a router stub with the real Radix dialogs, so what is asserted is
 * what a user sees.
 *
 * @see {@link file://./type-to-confirm.tsx}
 */
import type React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { DeleteAssetModel } from "~/components/asset-model/delete-asset-model";
import { DeleteAsset } from "~/components/assets/delete-asset";
import { DeleteAuditDialog } from "~/components/audit/delete-audit-dialog";
import { DeleteBooking } from "~/components/booking/delete-booking";
import {
  DeleteCategory,
  describeCategoryUsage,
} from "~/components/category/delete-category";
import DeleteKit from "~/components/kits/delete-kit";
import { DeleteLocation } from "~/components/location/delete-location";
import { DeleteTag, describeTagUsage } from "~/components/tag/delete-tag";
import { DeleteUser } from "~/components/user/delete-user";
import { TypeToConfirm, useTypeToConfirm } from "./type-to-confirm";

/** Renders inside a router so `Form`, fetchers and navigation state work. */
function renderInRouter(element: React.ReactElement) {
  const Stub = createRoutesStub([{ path: "/", Component: () => element }]);
  return render(<Stub initialEntries={["/"]} />);
}

const openButton = <button type="button">Open</button>;

/** A dialog under test: how to render it, its name, and its confirm label. */
type Surface = {
  name: string;
  element: React.ReactElement;
  expected: string;
  confirmLabel: RegExp;
  /** Controlled dialogs render open; the rest open from their trigger. */
  trigger?: RegExp;
};

const SURFACES: Surface[] = [
  {
    name: "asset",
    element: (
      <DeleteAsset
        asset={{ id: "a1", title: "Camera Kit", mainImage: null }}
        trigger={openButton}
      />
    ),
    expected: "Camera Kit",
    confirmLabel: /^delete$/i,
    trigger: /open/i,
  },
  {
    name: "kit",
    element: (
      <DeleteKit
        kit={{ id: "k1", name: "Studio Kit", image: null }}
        trigger={openButton}
      />
    ),
    expected: "Studio Kit",
    confirmLabel: /^delete$/i,
    trigger: /open/i,
  },
  {
    name: "location",
    element: (
      <DeleteLocation
        location={{ id: "l1", name: "Shelf B" }}
        trigger={openButton}
      />
    ),
    expected: "Shelf B",
    confirmLabel: /^delete$/i,
    trigger: /open/i,
  },
  {
    name: "booking",
    element: <DeleteBooking booking={{ name: "Film Shoot" }} />,
    expected: "Film Shoot",
    confirmLabel: /^delete$/i,
    trigger: /^delete$/i,
  },
  {
    name: "asset model",
    element: (
      <DeleteAssetModel
        assetModel={{ id: "m1", name: "Sony A7", _count: { assets: 2 } }}
        trigger={openButton}
      />
    ),
    expected: "Sony A7",
    confirmLabel: /^delete$/i,
    trigger: /open/i,
  },
  {
    name: "category in use",
    element: (
      <DeleteCategory
        category={{
          id: "c1",
          name: "Cameras",
          _count: {
            assets: 3,
            kits: 0,
            customFields: 0,
            assetModelDefaults: 0,
          },
        }}
        trigger={openButton}
      />
    ),
    expected: "Cameras",
    confirmLabel: /^delete$/i,
    trigger: /open/i,
  },
  {
    name: "tag in use",
    element: (
      <DeleteTag
        tag={{ id: "t1", name: "Fragile", _count: { assets: 0, bookings: 1 } }}
        trigger={openButton}
      />
    ),
    expected: "Fragile",
    confirmLabel: /^delete$/i,
    trigger: /open/i,
  },
  {
    name: "user (admin dashboard)",
    element: <DeleteUser email="sam@example.com" />,
    expected: "sam@example.com",
    confirmLabel: /^confirm$/i,
    trigger: /delete user/i,
  },
  {
    name: "audit",
    element: <DeleteAuditDialog auditName="Q3 Audit" open onClose={() => {}} />,
    expected: "Q3 Audit",
    confirmLabel: /^delete$/i,
  },
];

/**
 * Whether `field` is submitted by the form `button` submits: it sits inside
 * that form, or its `form` attribute names the form's id (the HTML rule; the
 * single-delete dialogs keep the field outside the form around the button).
 *
 * why: compares by structure, because under happy-dom `input.form` and
 * `form.contains(input)` disagree with `input.closest("form")`.
 */
function postsWith(field: HTMLElement, button: HTMLElement) {
  const form = button.closest("form");
  if (!form) return false;
  const owner = field.getAttribute("form");
  return owner ? owner === form.id : field.closest("form") === form;
}

/** Opens the dialog when it has a trigger, and returns the dialog element. */
async function openDialog(surface: Surface) {
  const user = userEvent.setup();
  renderInRouter(surface.element);
  if (surface.trigger) {
    await user.click(screen.getByRole("button", { name: surface.trigger }));
  }
  return { user, dialog: await screen.findByRole("alertdialog") };
}

describe.each(SURFACES)("typed confirm on the $name delete", (surface) => {
  it("names what to type and keeps the button off until it is typed", async () => {
    const { user, dialog } = await openDialog(surface);
    const confirm = within(dialog).getByRole("button", {
      name: surface.confirmLabel,
    });
    const field = within(dialog).getByRole("textbox", {
      name: "Confirmation",
    });

    expect(dialog).toHaveTextContent(
      `To confirm, type ${surface.expected} below.`
    );
    expect(confirm).toBeDisabled();
    // The typed value is posted with the delete, for the server to check.
    expect(postsWith(field, confirm)).toBe(true);
    expect(field).toHaveAttribute("name", "confirmation");

    await user.type(field, surface.expected.slice(0, -1));
    expect(confirm).toBeDisabled();

    // Case and stray spaces do not decide a delete.
    await user.clear(field);
    await user.type(field, `  ${surface.expected.toUpperCase()} `);
    expect(confirm).toBeEnabled();
  });
});

describe("a dialog reopened after a typed attempt", () => {
  it("starts empty with the button off", async () => {
    const { user, dialog } = await openDialog(SURFACES[0]);
    await user.type(
      within(dialog).getByRole("textbox", { name: "Confirmation" }),
      "Camera Kit"
    );
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await user.click(screen.getByRole("button", { name: /open/i }));
    const reopened = await screen.findByRole("alertdialog");

    expect(
      within(reopened).getByRole("textbox", { name: "Confirmation" })
    ).toHaveValue("");
    expect(
      within(reopened).getByRole("button", { name: /^delete$/i })
    ).toBeDisabled();
  });
});

describe("categories and tags nobody uses", () => {
  it("keep the one-click confirm for an unused category", async () => {
    const { dialog } = await openDialog({
      name: "unused category",
      element: (
        <DeleteCategory
          category={{
            id: "c2",
            name: "Spare",
            _count: {
              assets: 0,
              kits: 0,
              customFields: 0,
              assetModelDefaults: 0,
            },
          }}
          trigger={openButton}
        />
      ),
      expected: "Spare",
      confirmLabel: /^delete$/i,
      trigger: /open/i,
    });

    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: /^delete$/i })
    ).toBeEnabled();
  });

  it("keep the one-click confirm for an unused tag", async () => {
    const { dialog } = await openDialog({
      name: "unused tag",
      element: (
        <DeleteTag
          tag={{ id: "t2", name: "Old", _count: { assets: 0, bookings: 0 } }}
          trigger={openButton}
        />
      ),
      expected: "Old",
      confirmLabel: /^delete$/i,
      trigger: /open/i,
    });

    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: /^delete$/i })
    ).toBeEnabled();
  });

  it("describe what uses them in plain words", () => {
    expect(
      describeCategoryUsage({
        assets: 3,
        kits: 1,
        customFields: 0,
        assetModelDefaults: 2,
      })
    ).toBe("3 assets, 1 kit and 2 asset models");
    expect(
      describeCategoryUsage({
        assets: 0,
        kits: 0,
        customFields: 1,
        assetModelDefaults: 0,
      })
    ).toBe("1 custom field");
    expect(describeTagUsage({ assets: 1, bookings: 4 })).toBe(
      "1 asset and 4 bookings"
    );
    expect(describeTagUsage({ assets: 0, bookings: 0 })).toBeNull();
  });
});

describe("TypeToConfirm", () => {
  /** A bare field with a button, the way a dialog wires them. */
  function Harness({ expected }: { expected: string | number }) {
    const confirm = useTypeToConfirm(expected);
    return (
      <form>
        <TypeToConfirm
          expected={expected}
          value={confirm.value}
          onChange={confirm.setValue}
        />
        <button type="submit" disabled={!confirm.isConfirmed}>
          Delete
        </button>
      </form>
    );
  }

  it("posts what was typed under the field the server reads", async () => {
    const user = userEvent.setup();
    render(<Harness expected={12} />);
    const field = screen.getByRole("textbox", { name: "Confirmation" });

    await user.type(field, "12");

    expect(field).toHaveAttribute("name", "confirmation");
    expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
  });

  it("links the instruction to the field for screen readers", () => {
    render(<Harness expected="Camera Kit" />);
    const field = screen.getByRole("textbox", { name: "Confirmation" });

    expect(field).toHaveAccessibleDescription(
      "To confirm, type Camera Kit below."
    );
    expect(field).toHaveAttribute("autocomplete", "off");
  });
});
