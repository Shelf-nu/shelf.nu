/**
 * The scanned list across navigation.
 *
 * A scan page opens some dialogs as child routes (an audit's "Add comment" is
 * `…/scan/:auditAssetId/details`). Opening one and closing it again must keep
 * what the operator scanned. Any other navigation still clears the list, so a
 * check-out session can never leak into a check-in on the same booking.
 *
 * @see {@link file://./atoms-reset-handler.tsx}
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { createRoutesStub, Outlet, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";

import { AtomsResetHandler } from "./atoms-reset-handler";
import { scannedItemsAtom } from "./qr-scanner";

/** why: as in production, the handler renders as a sibling above the route. */
function Layout() {
  return (
    <>
      <AtomsResetHandler />
      <Outlet />
    </>
  );
}

/** A page with one button that navigates to the path in its value. */
function Page() {
  const navigate = useNavigate();
  return (
    <button
      data-testid="nav"
      onClick={(e) => navigate(e.currentTarget.value)}
    />
  );
}

const PATHS = [
  "/audits/a1/scan",
  "/audits/a1/scan/aa1/details",
  "/bookings/b1/overview",
  "/bookings/b1/overview/checkout-assets",
  "/bookings/b1/overview/checkin-assets",
];

/** Mounts at `url` and (unless told not to) seeds one scanned item. */
function renderAt(url: string, { seed: seedNow = true } = {}) {
  const store = createStore();
  const Stub = createRoutesStub([
    {
      Component: Layout,
      children: PATHS.map((path) => ({ path, Component: Page })),
    },
  ]);
  render(
    <Provider store={store}>
      <Stub initialEntries={[url]} />
    </Provider>
  );
  const seed = () =>
    act(() => {
      store.set(scannedItemsAtom, { qr1: { type: "asset" } as never });
    });
  if (seedNow) seed();

  const go = (path: string) => {
    const button = screen.getByTestId("nav") as HTMLButtonElement;
    button.value = path;
    act(() => {
      fireEvent.click(button);
    });
  };
  const scanned = () => Object.keys(store.get(scannedItemsAtom));
  return { go, scanned, seed };
}

describe("AtomsResetHandler: the scanned list", () => {
  it("keeps the list while a dialog opens on a child route and after it closes", () => {
    const { go, scanned } = renderAt("/audits/a1/scan");

    go("/audits/a1/scan/aa1/details");
    expect(scanned()).toEqual(["qr1"]);

    go("/audits/a1/scan");
    expect(scanned()).toEqual(["qr1"]);
  });

  it("clears the list when leaving the scan page for anywhere else", () => {
    const { go, scanned } = renderAt("/bookings/b1/overview/checkout-assets");

    go("/bookings/b1/overview");
    expect(scanned()).toEqual([]);
  });

  it("never carries one scan page's list to a sibling scan page", () => {
    const { go, scanned } = renderAt("/bookings/b1/overview/checkout-assets");

    go("/bookings/b1/overview/checkin-assets");
    expect(scanned()).toEqual([]);
  });

  it("clears the list when a dialog's child route leads somewhere other than back", () => {
    const { go, scanned } = renderAt("/audits/a1/scan");

    go("/audits/a1/scan/aa1/details");
    go("/bookings/b1/overview");
    expect(scanned()).toEqual([]);
  });
  it("keeps a check-out list out of check-in, reached through the booking page", () => {
    // The scan pages are themselves child routes of the booking overview, so
    // "overview -> check-out -> overview -> check-in" is the real path to a leak.
    const { go, scanned, seed } = renderAt("/bookings/b1/overview", {
      seed: false,
    });

    go("/bookings/b1/overview/checkout-assets");
    seed();
    go("/bookings/b1/overview");
    go("/bookings/b1/overview/checkin-assets");

    expect(scanned()).toEqual([]);
  });
});
