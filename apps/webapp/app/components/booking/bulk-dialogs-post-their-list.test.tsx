/**
 * The booking bulk dialogs post which bookings list they were opened on.
 *
 * Delete, archive and cancel open from `/bookings`, a kit's Bookings tab and an
 * asset's Bookings tab. On "Select all" the server resolves the selection from
 * the posted list and URL params, so each dialog's form must say which list it
 * is: `kitId` on a kit's tab, `assetId` on an asset's tab, neither on the index.
 * `/api/bookings/bulk-actions` reads those field names (pinned on that side in
 * `test/routes-tests/api+/bookings.bulk-actions.test.ts`).
 *
 * @see {@link file://./bookings-list-fields.tsx}
 */
import type React from "react";
import type { PropsWithChildren } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { BulkDialogType } from "~/components/bulk-update-dialog/bulk-update-dialog";
import type { ListItemData } from "~/components/list/list-item";
import { ALL_SELECTED_KEY } from "~/utils/list";
import BulkArchiveDialog from "./bulk-archive-dialog";
import BulkCancelDialog from "./bulk-cancel-dialog";
import BulkDeleteDialog from "./bulk-delete-dialog";

// why: the form is what is under test, not a submission; a plain form keeps
// the fields readable without a route action behind it.
vi.mock("~/hooks/use-fetcher-with-reset", () => ({
  default: () => ({
    state: "idle" as const,
    data: undefined,
    reset: vi.fn(),
    Form: ({
      children,
      ...props
    }: PropsWithChildren<Record<string, unknown>>) => (
      <form {...props}>{children}</form>
    ),
  }),
}));

// why: the org/cookie-aware wrapper reads the `_layout` loader, which is not
// mounted; the dialog only copies the current params into a hidden input.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams("s=camera"), vi.fn()] as const,
}));

const DIALOGS: {
  name: string;
  Dialog: () => React.JSX.Element;
  type: BulkDialogType;
}[] = [
  { name: "delete", Dialog: BulkDeleteDialog, type: "trash" },
  { name: "archive", Dialog: BulkArchiveDialog, type: "archive" },
  { name: "cancel", Dialog: BulkCancelDialog, type: "cancel" },
];

const PAGES = [
  {
    name: "/bookings",
    path: "/bookings",
    url: "/bookings",
    posts: {},
  },
  {
    name: "a kit's Bookings tab",
    path: "/kits/:kitId/bookings",
    url: "/kits/kit-1/bookings",
    posts: { kitId: "kit-1" },
  },
  {
    name: "an asset's Bookings tab",
    path: "/assets/:assetId/bookings",
    url: "/assets/asset-1/bookings",
    posts: { assetId: "asset-1" },
  },
];

/**
 * Renders `Dialog` on the route `path` at `url`, opens it on a "Select all",
 * and returns the fields its form would post.
 *
 * The dialog and selection atoms reset themselves when first subscribed, so
 * the seed is repeated until the dialog is on screen.
 */
async function postedFields(
  { Dialog, type }: (typeof DIALOGS)[number],
  { path, url }: (typeof PAGES)[number]
) {
  const store = createStore();
  const Stub = createRoutesStub([
    {
      path,
      Component: () => (
        <Provider store={store}>
          <span>route rendered</span>
          <Dialog />
        </Provider>
      ),
      loader: () => ({ totalItems: 3 }),
    },
  ]);
  render(<Stub initialEntries={[url]} />);
  await screen.findByText("route rendered");
  await waitFor(() => {
    act(() => {
      store.set(bulkDialogAtom, (prev) => ({ ...prev, [type]: true }));
      store.set(selectedBulkItemsAtom, [
        { id: ALL_SELECTED_KEY } as ListItemData,
      ]);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  const form = screen.getByRole("dialog").querySelector("form");
  return Object.fromEntries(new FormData(form ?? undefined));
}

describe.each(DIALOGS)("bulk $name of bookings", (dialog) => {
  it.each(PAGES)("posts the list it was opened on, on $name", async (page) => {
    const fields = await postedFields(dialog, page);

    expect({
      ...(fields.kitId !== undefined && { kitId: fields.kitId }),
      ...(fields.assetId !== undefined && { assetId: fields.assetId }),
    }).toEqual(page.posts);
    // The list travels with the URL params it is filtered by.
    expect(fields.currentSearchParams).toBe("s=camera");
  });
});
