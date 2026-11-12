/**
 * The bulk tag dialogs search tags through `useTagSuggestions`, each with its
 * own scope: "Assign tags" offers only tags usable on assets, "Remove tags"
 * offers every tag (an asset can hold a tag that is no longer asset-scoped).
 * These tests pin each dialog's requests, that typing in the dialog searches
 * the server, and that the dialog shows "Searching..." and a failed search.
 *
 * @see {@link file://./bulk-assign-tags-dialog.tsx}
 * @see {@link file://./bulk-remove-tags-dialog.tsx}
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BulkAssignTagsDialog from "./bulk-assign-tags-dialog";
import BulkRemoveTagsDialog from "./bulk-remove-tags-dialog";
import type { TagsFetcherData } from "../tag/use-tag-suggestions";
import {
  TAG_SEARCH_DEBOUNCE_MS,
  TAG_SEARCHING_TEXT,
} from "../tag/use-tag-suggestions";

const submit = vi.fn();
let searchData: TagsFetcherData | undefined;
let searchState: "idle" | "loading" = "idle";
let useFetcherCalls = 0;
/** Whether the mocked dialog shows its content, as the real one does when open. */
let dialogOpen = true;

// why: the requests the dialog's picker sends are the boundary under test.
// The hook calls `useFetcher` twice per render (first page, then search).
vi.mock("react-router", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("react-router")),
  useFetcher: () =>
    useFetcherCalls++ % 2 === 0
      ? { submit, data: undefined, state: "idle" }
      : { submit, data: searchData, state: searchState },
}));

// why: the dialog chrome (portal, selection atoms, submit fetcher) adds
// nothing to which tags the picker asks for. Like the real dialog, the mock
// renders its content only while open, so closing unmounts the picker.
vi.mock("../bulk-update-dialog/bulk-update-dialog", () => ({
  BulkUpdateDialogContent: ({
    children,
  }: {
    children: (props: {
      disabled: boolean;
      handleCloseDialog: () => void;
      fetcherError?: string;
    }) => ReactNode;
  }) => (
    <div>
      {dialogOpen
        ? children({ disabled: false, handleCloseDialog: () => {} })
        : null}
    </div>
  ),
}));

/** Parameters of every `/api/model-filters` request, in order. */
function requests() {
  return submit.mock.calls.map(([params, options]) => {
    expect(options).toEqual({ method: "GET", action: "/api/model-filters" });
    return params;
  });
}

/** Types into the dialog's tag box and lets the debounce fire. */
function typeAndWait(text: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value: text } });
  act(() => {
    vi.advanceTimersByTime(TAG_SEARCH_DEBOUNCE_MS);
  });
}

describe("bulk tag dialogs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    submit.mockReset();
    searchData = undefined;
    searchState = "idle";
    useFetcherCalls = 0;
    dialogOpen = true;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Assign tags asks only for tags usable on assets, also when typing", () => {
    render(<BulkAssignTagsDialog />);
    typeAndWait("ZZ Te");

    const [firstPage, search] = requests();
    expect(firstPage).toEqual(
      expect.objectContaining({ name: "tag", queryValue: "", useFor: "ASSET" })
    );
    expect(search).toEqual(
      expect.objectContaining({ queryValue: "ZZ Te", useFor: "ASSET" })
    );
  });

  it("Remove tags asks for every tag, also when typing", () => {
    render(<BulkRemoveTagsDialog />);
    typeAndWait("ZZ Te");

    const [firstPage, search] = requests();
    expect(firstPage).toEqual(
      expect.objectContaining({ name: "tag", queryValue: "" })
    );
    expect(firstPage).not.toHaveProperty("useFor");
    expect(search).toEqual(expect.objectContaining({ queryValue: "ZZ Te" }));
    expect(search).not.toHaveProperty("useFor");
  });

  it("says Searching while a search runs", () => {
    render(<BulkAssignTagsDialog />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ZZ Te" } });

    expect(screen.getByText(TAG_SEARCHING_TEXT)).toBeTruthy();
  });

  it("shows a failed search under the picker", () => {
    const { rerender } = render(<BulkAssignTagsDialog />);
    typeAndWait("ZZ Te");

    searchData = { error: { message: "Request timed out" } };
    rerender(<BulkAssignTagsDialog />);

    expect(screen.getByText("Request timed out")).toBeTruthy();
  });

  it("starts each opening fresh: no stale search, error or late request", () => {
    const { rerender } = render(<BulkAssignTagsDialog />);
    typeAndWait("ZZ Te");
    searchData = { error: { message: "Request timed out" } };
    rerender(<BulkAssignTagsDialog />);
    expect(screen.getByText("Request timed out")).toBeTruthy();

    // Type again, then close before the debounce fires.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "ZZ Tem" },
    });
    dialogOpen = false;
    rerender(<BulkAssignTagsDialog />);
    submit.mockReset();
    act(() => {
      vi.advanceTimersByTime(TAG_SEARCH_DEBOUNCE_MS);
    });
    expect(requests()).toEqual([]);

    dialogOpen = true;
    rerender(<BulkAssignTagsDialog />);

    expect(screen.queryByText("Request timed out")).toBeNull();
    expect(requests()).toEqual([
      expect.objectContaining({ queryValue: "", useFor: "ASSET" }),
    ]);
  });
});
