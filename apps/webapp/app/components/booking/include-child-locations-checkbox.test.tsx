/**
 * "Include assets from child locations" checkbox.
 *
 * Pins what the checkbox shows (the URL's state, or the state a pending
 * navigation on this page is about to reach) and what it writes (one param,
 * set or removed, and the page reset).
 *
 * @see {@link file://./include-child-locations-checkbox.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IncludeChildLocationsCheckbox } from "./include-child-locations-checkbox";

const PATHNAME = "/bookings/b1/overview/manage-assets";

const mockSearchParams = vi.hoisted(() => ({ value: new URLSearchParams() }));
const mockSetSearchParams = vi.hoisted(() => vi.fn());
const mockPendingLocation = vi.hoisted(() => ({
  value: undefined as { pathname: string; search: string } | undefined,
}));

// why: the checkbox reads the page's pathname and any pending navigation to
// decide what it shows; the tests stage both without a router.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    useLocation: () => ({ pathname: PATHNAME }),
    useNavigation: () => ({ location: mockPendingLocation.value }),
  };
});

// why: the cookie-aware hook needs loader data and an organization; the tests
// only need the URL it reads and the setter it hands back.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [mockSearchParams.value, mockSetSearchParams],
}));

/** The checkbox, found by its visible label. */
function checkbox() {
  return screen.getByRole("checkbox", {
    name: "Include assets from child locations",
  }) as HTMLInputElement;
}

/** Runs the updater the checkbox passed to the setter against `query`. */
function applyLastUpdate(query: string) {
  const updater = mockSetSearchParams.mock.lastCall?.[0] as (
    prev: URLSearchParams
  ) => URLSearchParams;
  return updater(new URLSearchParams(query)).toString();
}

beforeEach(() => {
  mockSearchParams.value = new URLSearchParams("location=campus");
  mockPendingLocation.value = undefined;
  mockSetSearchParams.mockReset();
});

describe("IncludeChildLocationsCheckbox", () => {
  it("is off by default", () => {
    render(<IncludeChildLocationsCheckbox />);

    expect(checkbox().checked).toBe(false);
  });

  it("is on when the URL says so", () => {
    mockSearchParams.value = new URLSearchParams(
      "location=campus&includeChildLocations=true"
    );
    render(<IncludeChildLocationsCheckbox />);

    expect(checkbox().checked).toBe(true);
  });

  it("turning it on sets the param and returns to the first page", () => {
    render(<IncludeChildLocationsCheckbox />);
    fireEvent.click(checkbox());

    expect(applyLastUpdate("location=campus&page=3")).toBe(
      "location=campus&includeChildLocations=true"
    );
  });

  it("turning it off removes the param and returns to the first page", () => {
    mockSearchParams.value = new URLSearchParams(
      "location=campus&includeChildLocations=true"
    );
    render(<IncludeChildLocationsCheckbox />);
    fireEvent.click(checkbox());

    expect(
      applyLastUpdate("location=campus&includeChildLocations=true&page=2")
    ).toBe("location=campus");
  });

  it("shows the state a pending navigation on this page is heading to", () => {
    mockPendingLocation.value = {
      pathname: PATHNAME,
      search: "?location=campus&includeChildLocations=true",
    };
    render(<IncludeChildLocationsCheckbox />);

    expect(checkbox().checked).toBe(true);
  });

  it("ignores a pending navigation to another page", () => {
    mockPendingLocation.value = {
      pathname: "/bookings/b1/overview/manage-kits",
      search: "?includeChildLocations=true",
    };
    render(<IncludeChildLocationsCheckbox />);

    expect(checkbox().checked).toBe(false);
  });
});
