/**
 * Tests for {@link QuantityCustodyList}'s release dialog.
 *
 * Scope is the one thing a client cannot get right on its own: what the user
 * sees when the SERVER rejects a release. The dialog clamps `consumed` against
 * the `maxQuantity` it was rendered with, so a page left open while someone
 * else moves the same units still submits a quantity the service refuses —
 * `releaseQuantity` throws 400 for a stale quantity, for `consumed` above the
 * released amount, and for consuming a returnable asset. Those messages are
 * written to be read by an operator, so they must reach one.
 *
 * Mocks:
 * - `react-router`'s `useFetcher` — so each test can drive the response
 *   without a data router.
 * - `~/hooks/use-disabled` — stable `false`, so submit gating is ours.
 * - `~/components/shared/modal` — Radix AlertDialog portals its content and
 *   manages `open` internally, and this dialog keeps `open` in component
 *   state rather than a prop, so a click-to-open flow is not reliably
 *   drivable in happy-dom. The shell below renders content unconditionally:
 *   open/close gating belongs to Radix and is not what these tests are about.
 * - `./quantity-custody-dialog` — the Assign counterpart, unrelated here and
 *   otherwise drags its own dependency graph into the render.
 *
 * @see {@link file://./quantity-custody-list.tsx}
 * @see {@link file://./move-units-dialog.test.tsx} — the harness this mirrors
 */

import type React from "react";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { QuantityCustodyList } from "./quantity-custody-list";

/** Mutable per-test fetcher state; reassign before `render`. */
type FetcherState = {
  state: "idle" | "submitting" | "loading";
  data: { success?: boolean; error?: { message?: string } } | undefined;
};

let mockFetcherState: FetcherState = { state: "idle", data: undefined };

// why: useFetcher returns a Form component plus the response state this
// component reads; we need to control that state per test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    Link: ({ children, ...rest }: { children: ReactNode }) => (
      <a {...rest}>{children}</a>
    ),
    useFetcher: () => ({
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
        <form {...rest} onSubmit={(e) => e.preventDefault()}>
          {children}
        </form>
      ),
      submit: vi.fn(),
      load: vi.fn(),
    }),
    useNavigation: () => ({ state: "idle" }),
  };
});

// why: useDisabled derives from useNavigation; stabilise so submit gating is
// driven by this component's own conditions.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

// why: see the file-level note — Radix portals content and owns `open`, which
// this dialog holds in component state, so content is rendered unconditionally.
vi.mock("~/components/shared/modal", () => ({
  AlertDialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  AlertDialogTrigger: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div role="alertdialog">{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// why: the Assign dialog is a separate surface with its own dependency graph
// and nothing to do with release-error rendering.
vi.mock("./quantity-custody-dialog", () => ({
  QuantityCustodyDialog: () => null,
}));

/** One operator-held custody row — the shape the overview loader returns. */
const custodyRecord = {
  createdAt: new Date("2026-08-01T00:00:00Z"),
  quantity: 10,
  custodian: { id: "tm-1", name: "Ada Lovelace" },
};

function renderList(
  props: Partial<React.ComponentProps<typeof QuantityCustodyList>> = {}
) {
  return render(
    <QuantityCustodyList
      custody={[custodyRecord]}
      assetId="asset-1"
      unitOfMeasure="pcs"
      consumptionType="ONE_WAY"
      availableQuantity={100}
      {...props}
    />
  );
}

describe("QuantityCustodyList — release dialog server errors", () => {
  beforeEach(() => {
    mockFetcherState = { state: "idle", data: undefined };
  });

  it("surfaces a rejected release so the operator knows why nothing happened", () => {
    // The exact 400 `releaseQuantity` throws when the page is stale and the
    // custodian no longer holds what the form is trying to release.
    mockFetcherState = {
      state: "idle",
      data: {
        error: {
          message: "Cannot release 10 units. The custodian only holds 4 units.",
        },
      },
    };

    renderList();

    expect(screen.getByRole("alert")).toHaveTextContent(
      /the custodian only holds 4 units/i
    );
  });

  it("surfaces a rejected consumed split", () => {
    mockFetcherState = {
      state: "idle",
      data: {
        error: {
          message:
            "Only consumable (one-way) assets can be marked as consumed.",
        },
      },
    };

    renderList({ consumptionType: "TWO_WAY" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      /only consumable \(one-way\) assets/i
    );
  });

  it("renders no alert when the fetcher is idle and untouched", () => {
    renderList();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders no alert on a successful release", () => {
    mockFetcherState = { state: "idle", data: { success: true } };

    renderList();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
