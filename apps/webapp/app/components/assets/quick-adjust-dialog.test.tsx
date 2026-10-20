/**
 * Tests for {@link QuickAdjustDialog}.
 *
 * Cover what the dialog says after a submission has been answered. A keyed
 * fetcher keeps handing back its last result for as long as its owner stays
 * mounted, and this dialog's trigger outlives the dialog's own content, so a
 * refusal has to be held separately from `fetcher.data` or it comes back the
 * next time the dialog opens.
 *
 * Also pin the fetcher key to the asset: the asset page mounts this dialog
 * twice (the header menu and the quantity card), and one shared key makes
 * those two instances report each other's results.
 *
 * Mocks:
 * - `react-router`'s `useFetcher` so fetcher state is driven per test without
 *   a data router, and the key it is given can be asserted on. `Form` becomes
 *   a plain `<form>` whose submit is captured by `mockSubmit`.
 * - `~/hooks/use-disabled` as a stable `false`, so the action buttons are
 *   never disabled by navigation state.
 * - `~/components/shared/modal`, because Radix `AlertDialog` portals its
 *   content and gates on internally-managed state; the shell here lets the
 *   controlled `open` prop drive visibility directly (mirrors
 *   `adjust-booking-asset-quantity-dialog.test.tsx`).
 *
 * @see {@link file://./quick-adjust-dialog.tsx}
 */

import type React from "react";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuickAdjustDialog } from "./quick-adjust-dialog";

/** Mutable per-test fetcher state, reassigned in `beforeEach`. */
type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data: { success?: boolean; error?: { message?: string } | null } | undefined;
};

let mockFetcherState: FetcherState = { state: "idle", data: undefined };
let mockSubmit = vi.fn();
/** Every key `useFetcher` was called with this test, in call order. */
let fetcherKeys: (string | undefined)[] = [];

// why: useFetcher returns a Form component plus the state we drive per test,
// and its key is itself under test here.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: (options?: { key?: string }) => {
      fetcherKeys.push(options?.key);
      return {
        ...mockFetcherState,
        Form: ({
          children,
          onSubmit,
          ...rest
        }: {
          children: ReactNode;
          onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
          [key: string]: unknown;
        }) => (
          <form {...rest} onSubmit={onSubmit}>
            {children}
          </form>
        ),
        submit: mockSubmit,
      };
    },
  };
});

// why: useDisabled reads navigation/fetcher plumbing; stabilise it so Add and
// Remove are always clickable.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: AlertDialog portals through Radix and manages its own open state. The
// shell keeps the controlled `open` prop as the only thing driving visibility.
vi.mock("~/components/shared/modal", () => {
  const AlertDialog = ({
    open,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: ReactNode;
  }) => <>{open ? children : null}</>;
  const passthrough = ({ children }: { children: ReactNode }) => (
    <>{children}</>
  );
  const AlertDialogContent = ({ children }: { children: ReactNode }) => (
    <div role="alertdialog">{children}</div>
  );
  const block = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog,
    AlertDialogTrigger: passthrough,
    AlertDialogContent,
    AlertDialogHeader: block,
    AlertDialogTitle: ({ children }: { children: ReactNode }) => (
      <h2>{children}</h2>
    ),
    AlertDialogDescription: ({ children }: { children: ReactNode }) => (
      <p>{children}</p>
    ),
    AlertDialogFooter: block,
    AlertDialogCancel: passthrough,
  };
});

describe("QuickAdjustDialog", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
    mockSubmit = vi.fn();
    fetcherKeys = [];
  });

  function dialog(
    open: boolean,
    onOpenChange: (v: boolean) => void,
    assetId = "asset-1"
  ) {
    return (
      <QuickAdjustDialog
        assetId={assetId}
        unitOfMeasure="pcs"
        availableQuantity={5}
        open={open}
        onOpenChange={onOpenChange}
      />
    );
  }

  it("scopes the fetcher key to the asset", () => {
    render(dialog(true, vi.fn(), "asset-1"));
    render(dialog(true, vi.fn(), "asset-2"));

    // Two dialogs for two assets must never share a fetcher, and neither may
    // the asset page's own two instances of this dialog for one asset.
    expect(fetcherKeys).toContain("adjust-quantity-asset-1");
    expect(fetcherKeys).toContain("adjust-quantity-asset-2");
    expect(fetcherKeys).not.toContain("adjust-quantity");
  });

  describe("stale submission errors", () => {
    const REFUSAL = "Only 5 pcs are available.";
    const CLIENT_ERROR = /Cannot remove 9 pcs/i;

    /** Drives one submission that the server refuses. */
    function refuse(
      rerender: (ui: React.ReactElement) => void,
      onOpenChange: (v: boolean) => void
    ) {
      mockFetcherState = { state: "submitting", data: undefined };
      rerender(dialog(true, onOpenChange));
      mockFetcherState = {
        state: "idle",
        data: { error: { message: REFUSAL } },
      };
      rerender(dialog(true, onOpenChange));
    }

    it("shows a refusal the server has just sent back", () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(dialog(true, onOpenChange));

      refuse(rerender, onOpenChange);

      expect(screen.getByText(REFUSAL)).toBeInTheDocument();
    });

    it("drops that refusal when the dialog is opened again", () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(dialog(true, onOpenChange));
      refuse(rerender, onOpenChange);
      expect(screen.getByText(REFUSAL)).toBeInTheDocument();

      // The operator closes the dialog and comes back to it later. The fetcher
      // is keyed, so it is still handing back that same refusal.
      rerender(dialog(false, onOpenChange));
      rerender(dialog(true, onOpenChange));

      expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument();
    });

    it("drops a client-side validation error when the dialog is opened again", () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(dialog(true, onOpenChange));

      // Removing more than the 5 available is refused before it is sent.
      fireEvent.change(screen.getByLabelText(/Quantity/i), {
        target: { value: "9" },
      });
      fireEvent.click(screen.getByRole("button", { name: /^Remove$/ }));
      expect(screen.getByText(CLIENT_ERROR)).toBeInTheDocument();
      expect(mockSubmit).not.toHaveBeenCalled();

      rerender(dialog(false, onOpenChange));
      rerender(dialog(true, onOpenChange));

      expect(screen.queryByText(CLIENT_ERROR)).not.toBeInTheDocument();
    });

    it("stays open when mounted fresh while the fetcher holds an earlier success", () => {
      // The asset page's header menu renders this dialog only while open, so
      // every opening is a fresh mount, and the keyed fetcher is still holding
      // the result of the last adjustment that went through.
      mockFetcherState = {
        state: "idle",
        data: { success: true, error: null },
      };
      const onOpenChange = vi.fn();

      render(dialog(true, onOpenChange));

      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("does not close itself again on reopen while the fetcher holds a success", () => {
      const onOpenChange = vi.fn();
      const { rerender } = render(dialog(true, onOpenChange));

      mockFetcherState = { state: "submitting", data: undefined };
      rerender(dialog(true, onOpenChange));
      // `payload()` stamps `error: null` onto every success, so a success is
      // told apart by the VALUE being null, never by the key being absent.
      mockFetcherState = {
        state: "idle",
        data: { success: true, error: null },
      };
      rerender(dialog(true, onOpenChange));

      // The accepted submission closes it once.
      expect(onOpenChange).toHaveBeenCalledWith(false);
      onOpenChange.mockClear();

      rerender(dialog(false, onOpenChange));
      rerender(dialog(true, onOpenChange));

      expect(onOpenChange).not.toHaveBeenCalled();
    });
  });
});
