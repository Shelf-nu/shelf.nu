/**
 * The typed count on every bulk delete dialog.
 *
 * Each dialog keeps Delete disabled until the user types the number of
 * selected items: the selection's length, or the list's total on a "select
 * all". When the server refuses because its own count differs, the dialog asks
 * for the server's number instead, so the user confirms exactly what goes.
 *
 * @see {@link file://./bulk-delete-confirmation.tsx}
 * @see {@link file://../../utils/delete-confirmation.server.ts}
 */
import type React from "react";
import type { PropsWithChildren } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import BulkDeleteAssetModels from "~/components/asset-model/bulk-delete-dialog";
import BulkDeleteAssets from "~/components/assets/bulk-delete-dialog";
import BulkDeleteAudits from "~/components/audit/bulk-delete-audits-dialog";
import BulkDeleteBookings from "~/components/booking/bulk-delete-dialog";
import BulkDeleteCategories from "~/components/category/bulk-delete-dialog";
import BulkDeleteKits from "~/components/kits/bulk-delete-dialog";
import type { ListItemData } from "~/components/list/list-item";
import BulkDeleteLocations from "~/components/location/bulk-delete-dialog";
import BulkDeleteNRMs from "~/components/nrm/bulk-delete-dialog";
import BulkDeleteTags from "~/components/tag/bulk-delete-dialog";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { BulkDialogType } from "./bulk-update-dialog";

const hoisted = vi.hoisted(() => ({
  fetcherData: undefined as Record<string, unknown> | undefined,
}));

// why: a refusal from the server is what the second suite is about; the fake
// fetcher lets a test hand the dialog that response without a route action.
vi.mock("~/hooks/use-fetcher-with-reset", () => ({
  default: () => ({
    state: "idle" as const,
    data: hoisted.fetcherData,
    reset: vi.fn(),
    Form: ({
      children,
      ...props
    }: PropsWithChildren<Record<string, unknown>>) => (
      <form {...props}>{children}</form>
    ),
  }),
}));

// why: the dialog reads this org/cookie-aware wrapper only to copy the current
// params into a hidden input; empty params are all these assertions need.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));

afterEach(() => {
  hoisted.fetcherData = undefined;
});

/** The list total the index loader reports, used on a "select all". */
const TOTAL_ITEMS = 42;

const DIALOGS: {
  name: string;
  Dialog: () => React.JSX.Element;
  type: BulkDialogType;
}[] = [
  { name: "assets", Dialog: BulkDeleteAssets, type: "trash" },
  { name: "kits", Dialog: BulkDeleteKits, type: "trash" },
  { name: "locations", Dialog: BulkDeleteLocations, type: "trash" },
  { name: "bookings", Dialog: BulkDeleteBookings, type: "trash" },
  { name: "categories", Dialog: BulkDeleteCategories, type: "trash" },
  { name: "tags", Dialog: BulkDeleteTags, type: "trash" },
  { name: "non-registered members", Dialog: BulkDeleteNRMs, type: "trash" },
  { name: "asset models", Dialog: BulkDeleteAssetModels, type: "trash" },
  { name: "audits", Dialog: BulkDeleteAudits, type: "delete-audit" },
];

/**
 * Renders a bulk dialog under a router (for its loader data) and a jotai
 * store, then opens it with the given selection. The atoms reset on mount, so
 * they are seeded after the first render.
 */
async function renderOpen(
  { Dialog, type }: (typeof DIALOGS)[number],
  selection: ListItemData[]
) {
  const store = createStore();
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <Provider store={store}>
          <span>route rendered</span>
          <Dialog />
        </Provider>
      ),
      loader: () => ({ totalItems: TOTAL_ITEMS }),
    },
  ]);
  render(<Stub initialEntries={["/"]} />);
  // Wait for the loader before seeding: the dialog subscribes on mount.
  await screen.findByText("route rendered");
  await act(async () => {
    store.set(bulkDialogAtom, (prev) => ({ ...prev, [type]: true }));
    store.set(selectedBulkItemsAtom, selection);
    await Promise.resolve();
  });
  return screen.findByRole("dialog");
}

const THREE_ROWS = [{ id: "r1" }, { id: "r2" }, { id: "r3" }] as ListItemData[];

describe.each(DIALOGS)("bulk delete of $name", (entry) => {
  it("asks for the number selected before Delete is enabled", async () => {
    const user = userEvent.setup();
    const dialog = await renderOpen(entry, THREE_ROWS);
    const deleteButton = within(dialog).getByRole("button", {
      name: /^delete$/i,
    });
    const field = within(dialog).getByRole("textbox", {
      name: "Confirmation",
    });

    expect(dialog).toHaveTextContent("To confirm, type 3 below.");
    expect(dialog).toHaveTextContent("cannot be undone");
    expect(deleteButton).toBeDisabled();

    await user.type(field, "2");
    expect(deleteButton).toBeDisabled();

    await user.clear(field);
    await user.type(field, "3");
    expect(deleteButton).toBeEnabled();
    // Posted under the field name the bulk endpoints read.
    expect(field).toHaveAttribute("name", "confirmation");
  });

  it("asks for the list's total on a select all", async () => {
    const dialog = await renderOpen(entry, [
      ...THREE_ROWS,
      { id: ALL_SELECTED_KEY } as ListItemData,
    ]);

    expect(dialog).toHaveTextContent(`To confirm, type ${TOTAL_ITEMS} below.`);
  });
});

describe("a select all the server counts differently", () => {
  it("asks for the server's number and shows why", async () => {
    hoisted.fetcherData = {
      error: {
        message:
          "Nothing was deleted. Your selection matches 45 kits, not 42. Type 45 to delete them.",
        additionalData: { expectedConfirmation: 45 },
      },
    };
    const user = userEvent.setup();
    const dialog = await renderOpen(DIALOGS[1], [
      { id: ALL_SELECTED_KEY } as ListItemData,
    ]);
    const deleteButton = within(dialog).getByRole("button", {
      name: /^delete$/i,
    });
    const field = within(dialog).getByRole("textbox", {
      name: "Confirmation",
    });

    expect(dialog).toHaveTextContent("To confirm, type 45 below.");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "matches 45 kits, not 42"
    );

    // The number the dialog first showed no longer unlocks it.
    await user.type(field, "42");
    expect(deleteButton).toBeDisabled();

    await user.clear(field);
    await user.type(field, "45");
    expect(deleteButton).toBeEnabled();
  });
});
