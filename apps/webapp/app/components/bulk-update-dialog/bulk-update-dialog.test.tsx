/**
 * Behaviour tests for {@link BulkUpdateDialogContent}'s post-success selection
 * handling.
 *
 * `BulkUpdateDialogContent` is the chokepoint ~37 bulk-action dialogs route
 * through. The contract under test: on a successful mutation it clears the
 * shared bulk selection (`selectedBulkItemsAtom`) by default — so the user does
 * not have to manually "unselect all" before the next batch — and closes the
 * dialog (`bulkDialogAtom[type]` -> false). Two opt-outs are independent:
 *   - `keepSelectionOnSuccess` retains the selection (for in-dialog success
 *     panels that re-use it).
 *   - `skipCloseOnSuccess` keeps the dialog open.
 * On a fetcher error neither clearing nor closing happens.
 *
 * Tests assert on observable atom state (the real atoms, never mocked), driven
 * by a controllable fake fetcher.
 *
 * @see {@link file://./bulk-update-dialog.tsx}
 */

import type { PropsWithChildren } from "react";
import { act, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { ListItemData } from "~/components/list/list-item";
import type { BulkDialogType } from "./bulk-update-dialog";
import { BulkUpdateDialogContent } from "./bulk-update-dialog";

/**
 * Hoisted, mutable fetcher state read by the (hoisted) `vi.mock` factory.
 * `data` is what the fake fetcher exposes; mutating it + rerendering simulates a
 * server response landing.
 */
const hoisted = vi.hoisted(() => ({
  fetcherData: undefined as Record<string, unknown> | undefined,
}));

// why: drive the dialog's success/error effect deterministically without a real
// Remix route + network. The fake fetcher exposes controllable `.data` (from
// hoisted state) and a plain `<form>` for `.Form`, so no router context is
// needed and `isFormProcessing("idle")` keeps `disabled` false.
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

// why: the dialog reads `useSearchParams` from this org/cookie-aware wrapper
// only to fold the current params into a hidden input; an empty params object
// is all the assertions need.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()] as const,
}));

beforeEach(() => {
  hoisted.fetcherData = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

/** A handful of selected rows to seed the selection atom with. */
const SELECTION = [
  { id: "a1" },
  { id: "a2" },
  { id: "a3" },
] as unknown as ListItemData[];

/**
 * The `BulkUpdateDialogContent` props these tests drive. Kept as one alias so
 * the render helper, the rerender helper and `open` cannot drift apart.
 */
type DialogTestProps = {
  keepSelectionOnSuccess?: boolean;
  skipCloseOnSuccess?: boolean;
  allowBodyOverflow?: boolean;
  className?: string;
};

/**
 * Renders the dialog for a given `type` under a dedicated jotai store, then
 * seeds the dialog-open + selection atoms. Seeding happens AFTER the first
 * render (inside `act`) on purpose: both atoms reset themselves via `onMount`
 * when first subscribed, so seeding before render would be clobbered. Returns
 * the store so tests can read the resulting atom state.
 */
async function renderDialog(type: BulkDialogType, props: DialogTestProps = {}) {
  const store = createStore();

  const utils = render(
    <Provider store={store}>
      <BulkUpdateDialogContent type={type} arrayFieldId="assetIds" {...props}>
        <button type="submit">Confirm</button>
      </BulkUpdateDialogContent>
    </Provider>
  );

  // Seed the dialog open for this type and a non-empty selection now that the
  // atoms have mounted (and their reset-on-mount has already run).
  await act(async () => {
    store.set(bulkDialogAtom, (prev) => ({ ...prev, [type]: true }));
    store.set(selectedBulkItemsAtom, SELECTION);
    await Promise.resolve();
  });

  return { store, ...utils };
}

/** Flips the fake fetcher to a response and flushes the success/error effect. */
async function resolveFetcher(
  utils: Awaited<ReturnType<typeof renderDialog>>,
  data: Record<string, unknown>
) {
  hoisted.fetcherData = data;
  await act(async () => {
    utils.rerender(
      <Provider store={utils.store}>
        <BulkUpdateDialogContent
          type={lastType}
          arrayFieldId="assetIds"
          {...lastProps}
        >
          <button type="submit">Confirm</button>
        </BulkUpdateDialogContent>
      </Provider>
    );
    await Promise.resolve();
  });
}

// Remember the last render config so `resolveFetcher` can rerender identically.
let lastType: BulkDialogType;
let lastProps: DialogTestProps;

/** Wraps `renderDialog` capturing config for the rerender helper. */
function open(type: BulkDialogType, props: DialogTestProps = {}) {
  lastType = type;
  lastProps = props;
  return renderDialog(type, props);
}

describe("BulkUpdateDialogContent — post-success selection handling", () => {
  it("clears the selection and closes the dialog on success (non-destructive type)", async () => {
    const utils = await open("location");

    expect(utils.store.get(selectedBulkItemsAtom)).toHaveLength(3);

    await resolveFetcher(utils, { success: true });

    // Selection emptied + dialog closed.
    expect(utils.store.get(selectedBulkItemsAtom)).toEqual([]);
    expect(utils.store.get(bulkDialogAtom).location).toBe(false);
  });

  it.each(["trash", "archive", "cancel", "delete-audit"] as const)(
    "still clears the selection on success for destructive type %s",
    async (type) => {
      const utils = await open(type);

      await resolveFetcher(utils, { success: true });

      expect(utils.store.get(selectedBulkItemsAtom)).toEqual([]);
      expect(utils.store.get(bulkDialogAtom)[type]).toBe(false);
    }
  );

  it("retains the selection on success when keepSelectionOnSuccess is set", async () => {
    const utils = await open("booking-exist", { keepSelectionOnSuccess: true });

    await resolveFetcher(utils, { success: true });

    // Selection is untouched (re-used by the in-dialog success panel).
    expect(utils.store.get(selectedBulkItemsAtom)).toEqual(SELECTION);
  });

  it("clears the selection but keeps the dialog open when only skipCloseOnSuccess is set", async () => {
    // Synthetic prop combo to isolate the orthogonality contract: the real
    // add-to-audit call site pairs skipCloseOnSuccess with keepSelectionOnSuccess.
    // Here we omit keepSelectionOnSuccess to prove the two opt-outs are independent.
    const utils = await open("add-to-audit", { skipCloseOnSuccess: true });

    await resolveFetcher(utils, { success: true });

    // Orthogonal opt-outs: selection cleared, dialog stays open.
    expect(utils.store.get(selectedBulkItemsAtom)).toEqual([]);
    expect(utils.store.get(bulkDialogAtom)["add-to-audit"]).toBe(true);
  });

  it("does not clear the selection or close the dialog on a fetcher error", async () => {
    const utils = await open("location");

    await resolveFetcher(utils, { error: { message: "Boom" } });

    expect(utils.store.get(selectedBulkItemsAtom)).toEqual(SELECTION);
    expect(utils.store.get(bulkDialogAtom).location).toBe(true);
  });
});

/**
 * `.dialog-allows-overflow` switches `.dialog-body` to `overflow: visible`,
 * which removes the ONLY scroll container a dialog has. It used to be applied
 * to every bulk dialog, so any dialog taller than the panel's
 * `md:max-h-[calc(100vh-4rem)]` cap pushed its footer past the viewport with no
 * way to reach it — the bulk "Create audit" dialog lost its submit button on
 * short windows that way (#2894).
 *
 * happy-dom applies no real stylesheet, so these assert on the class contract
 * rather than computed overflow: the class must be opt-in per dialog.
 */
describe("BulkUpdateDialogContent — body overflow opt-in", () => {
  /** The portaled `<dialog>` element the Dialog renders into `document.body`. */
  const dialogEl = () => document.querySelector("dialog.dialog");

  it("does not make the body overflow-visible by default", async () => {
    await open("start-audit");

    expect(dialogEl()).not.toBeNull();
    expect(dialogEl()?.classList.contains("dialog-allows-overflow")).toBe(
      false
    );
  });

  it("makes the body overflow-visible when allowBodyOverflow is set", async () => {
    await open("tag-add", { allowBodyOverflow: true });

    expect(dialogEl()?.classList.contains("dialog-allows-overflow")).toBe(true);
  });

  it("keeps the caller's own className alongside the opt-in", async () => {
    // `test-caller-class` is a deliberate non-Tailwind sentinel: `tw()` is
    // `twMerge`, which would collapse a second width utility into the first and
    // hide a regression that dropped the caller's classes.
    await open("tag-add", {
      allowBodyOverflow: true,
      className: "md:w-[600px] test-caller-class",
    });

    const el = dialogEl();
    expect(el?.classList.contains("dialog-allows-overflow")).toBe(true);
    expect(el?.classList.contains("test-caller-class")).toBe(true);
    expect(el?.className).toContain("md:w-[600px]");
    // The two width sources are `className || "lg:w-[400px]"` — mutually
    // exclusive, so a caller class REPLACES the default rather than joining it.
    expect(el?.className).not.toContain("lg:w-[400px]");
  });

  it("falls back to the default width when no className is passed", async () => {
    await open("tag-add", { allowBodyOverflow: true });

    expect(dialogEl()?.className).toContain("lg:w-[400px]");
  });
});
