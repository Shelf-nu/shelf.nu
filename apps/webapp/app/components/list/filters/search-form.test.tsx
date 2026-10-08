/**
 * Regression tests for the list search field's debounce.
 *
 * Every change to `?s=` is a router navigation, and each navigation issues one
 * single-fetch `*.data` request. Undebounced, typing costs one server-side
 * loader run per character, which exhausts `appLoaderRateLimit`'s budget (60
 * `.data` requests per 60s per `(userId, path)`) and drops the user on the
 * "Too many requests" error boundary mid-task.
 *
 * These tests assert the observable contract — how many navigations a burst of
 * typing causes — rather than the timer plumbing.
 *
 * @see {@link file://./search-form.tsx}
 * @see {@link file://./../../../../server/rate-limit.ts}
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchForm } from "./search-form";

const mockNavigation = vi.hoisted(() => ({
  value: {} as { location?: unknown },
}));
const mockSearchParams = vi.hoisted(() => new URLSearchParams());
const mockSetSearchParams = vi.hoisted(() => vi.fn());
const mockLoaderData = vi.hoisted(() => ({
  value: {
    search: null as string | null,
    modelName: { singular: "asset", plural: "assets" },
    searchFieldLabel: "Search kits",
  },
}));

// why: drive navigation state and loader data directly — the component reads
// both through router hooks that need a real router otherwise.
vi.mock("react-router", async () => {
  const actual = (await vi.importActual("react-router")) as Record<
    string,
    unknown
  >;

  return {
    ...actual,
    useNavigation: () => mockNavigation.value,
    useLoaderData: () => mockLoaderData.value,
  };
});

// why: capture the setter so the test can count navigations without routing.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams] as const,
}));

// why: this hook reads asset-index-only route data that isn't present here.
vi.mock("~/hooks/use-asset-index-view-state", () => ({
  useAssetIndexViewState: () => ({ modeIsAdvanced: false }),
}));

/** Resolve the `?s=` value a recorded setSearchParams call would produce. */
function resolveSearchTerm(callIndex: number) {
  const setter = mockSetSearchParams.mock.calls[callIndex][0] as (
    prev: URLSearchParams
  ) => URLSearchParams;
  return setter(new URLSearchParams()).get("s");
}

/**
 * Advance past the debounce window inside `act()` so React flushes the state
 * update the timer callback performs (otherwise every test logs an act warning).
 */
function advancePastDebounce() {
  act(() => {
    vi.advanceTimersByTime(400);
  });
}

describe("SearchForm debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // why: clearAllMocks does not drain queued *Once implementations, so reset
    // the call history explicitly between tests.
    mockSetSearchParams.mockReset();
    mockNavigation.value = {};
    mockLoaderData.value.search = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues ONE navigation for a burst of typing, not one per character", () => {
    render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    // A nine-character search: one `.data` request per character without the
    // debounce.
    const term = "broadcast";
    for (let i = 1; i <= term.length; i++) {
      fireEvent.change(input, { target: { value: term.slice(0, i) } });
    }

    // Nothing dispatched while the user is still typing.
    expect(mockSetSearchParams).not.toHaveBeenCalled();

    advancePastDebounce();

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    expect(resolveSearchTerm(0)).toBe("broadcast");
  });

  it("keeps 60+ characters of typing under the rate limiter's per-minute budget", () => {
    render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    // Four separate searches, ~16 characters each. Undebounced that is 64
    // requests against one bucket, past the limiter's 60 and into a 429.
    for (const term of [
      "alpha equipment 1",
      "beta equipment 22",
      "gamma kit 333333",
      "delta kit 4444444",
    ]) {
      for (let i = 1; i <= term.length; i++) {
        fireEvent.change(input, { target: { value: term.slice(0, i) } });
      }
      advancePastDebounce();
    }

    expect(mockSetSearchParams).toHaveBeenCalledTimes(4);
  });

  it("replaces history entries so Back does not walk through the query letter by letter", () => {
    render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    fireEvent.change(input, { target: { value: "kit" } });
    advancePastDebounce();

    expect(mockSetSearchParams).toHaveBeenCalledWith(expect.any(Function), {
      replace: true,
    });
  });

  it("resets pagination when the search term changes", () => {
    render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    fireEvent.change(input, { target: { value: "kit" } });
    advancePastDebounce();

    const setter = mockSetSearchParams.mock.calls[0][0] as (
      prev: URLSearchParams
    ) => URLSearchParams;
    const next = setter(new URLSearchParams("page=3"));

    expect(next.get("page")).toBeNull();
  });

  it("clears the search term when the field is emptied", () => {
    mockLoaderData.value.search = "kit";
    render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    fireEvent.change(input, { target: { value: "" } });
    advancePastDebounce();

    expect(mockSetSearchParams).toHaveBeenCalledTimes(1);
    const setter = mockSetSearchParams.mock.calls[0][0] as (
      prev: URLSearchParams
    ) => URLSearchParams;
    expect(setter(new URLSearchParams("s=kit&page=2")).get("s")).toBeNull();
  });

  it("shows the busy indicator from the FIRST keystroke, not after the debounce", () => {
    // why: a debounce that only shows the spinner once the navigation starts
    // leaves the field looking idle while the user types.
    render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    fireEvent.change(input, { target: { value: "b" } });

    // Still inside the debounce window — no navigation yet, but the clear
    // button must already be showing its spinner.
    expect(mockSetSearchParams).not.toHaveBeenCalled();
    expect(screen.getByTitle("Clear search")).toBeDisabled();
  });

  it("does not dispatch a scheduled search after the field unmounts", () => {
    // why: these modals close while a debounce can still be in flight.
    const { unmount } = render(<SearchForm />);
    const input = screen.getByLabelText("Search kits");

    fireEvent.change(input, { target: { value: "kit" } });
    unmount();
    advancePastDebounce();

    expect(mockSetSearchParams).not.toHaveBeenCalled();
  });
});
