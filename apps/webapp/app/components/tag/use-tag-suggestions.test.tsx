/**
 * Tag pickers that read `/api/model-filters` get one page of tags per request,
 * so the only way to reach a tag past that page is to search for it. These
 * tests pin that typing sends the typed text to the server (debounced and
 * trimmed), that a failed search keeps the tags already shown, that an empty
 * box shows the first page at once, and that picked tags survive a new search.
 *
 * @see {@link file://./use-tag-suggestions.ts}
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TagsAutocomplete } from "./tags-autocomplete";
import type { TagsFetcherData } from "./use-tag-suggestions";
import {
  TAG_SEARCH_DEBOUNCE_MS,
  TAG_SEARCHING_TEXT,
  useTagSuggestions,
} from "./use-tag-suggestions";

const submit = vi.fn();
/** Responses of the hook's two fetchers: the first page, and searches. */
let firstPageData: TagsFetcherData | undefined;
let searchData: TagsFetcherData | undefined;
let firstPageState: "idle" | "loading" = "idle";
let searchState: "idle" | "loading" = "idle";
let useFetcherCalls = 0;

// why: the requests the hook sends and the responses it reads are the
// boundary under test; a data router adds nothing to them. The hook calls
// `useFetcher` twice per render, first-page fetcher first, so calls alternate.
vi.mock("react-router", () => ({
  useFetcher: () =>
    useFetcherCalls++ % 2 === 0
      ? { submit, data: firstPageData, state: firstPageState }
      : { submit, data: searchData, state: searchState },
}));

/** The query values sent to `/api/model-filters`, in order. */
function sentQueries() {
  return submit.mock.calls.map(([params]) => params.queryValue);
}

/** Lets the debounce timer fire. */
function flushDebounce() {
  act(() => {
    vi.advanceTimersByTime(TAG_SEARCH_DEBOUNCE_MS);
  });
}

const FIRST_PAGE: TagsFetcherData = {
  filters: [
    { id: "t-a", name: "Audio" },
    { id: "t-b", name: "Broadcast" },
  ],
};

const SEARCH_RESULT: TagsFetcherData = {
  filters: [{ id: "t-zz", name: "ZZ Test Tag" }],
};

beforeEach(() => {
  vi.useFakeTimers();
  submit.mockReset();
  firstPageData = undefined;
  searchData = undefined;
  firstPageState = "idle";
  searchState = "idle";
  useFetcherCalls = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useTagSuggestions", () => {
  it("loads the first page on mount, scoped to useFor", () => {
    renderHook(() => useTagSuggestions({ useFor: "ASSET" }));

    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(
      { name: "tag", queryKey: "name", queryValue: "", useFor: "ASSET" },
      { method: "GET", action: "/api/model-filters" }
    );
  });

  it("omits useFor when the picker offers every tag", () => {
    renderHook(() => useTagSuggestions());

    expect(submit.mock.calls[0][0]).not.toHaveProperty("useFor");
  });

  it("searches the server with the typed text after the debounce", () => {
    const { result } = renderHook(() => useTagSuggestions({ useFor: "ASSET" }));
    submit.mockReset();

    act(() => result.current.onInputChange("ZZ Te"));
    expect(submit).not.toHaveBeenCalled();
    expect(result.current.isSearching).toBe(true);

    flushDebounce();
    expect(submit).toHaveBeenCalledWith(
      {
        name: "tag",
        queryKey: "name",
        queryValue: "ZZ Te",
        useFor: "ASSET",
      },
      { method: "GET", action: "/api/model-filters" }
    );
  });

  it("trims the typed text", () => {
    const { result } = renderHook(() => useTagSuggestions());
    submit.mockReset();

    act(() => result.current.onInputChange("  x  "));
    flushDebounce();

    expect(sentQueries()).toEqual(["x"]);
  });

  it("sends one request for a burst of keystrokes", () => {
    const { result } = renderHook(() => useTagSuggestions());
    submit.mockReset();

    act(() => {
      result.current.onInputChange("I");
      result.current.onInputChange("ZZ");
      result.current.onInputChange("ZZ T");
    });
    flushDebounce();

    expect(sentQueries()).toEqual(["ZZ T"]);
  });

  it("sends nothing when it unmounts before the debounce fires", () => {
    const { result, unmount } = renderHook(() => useTagSuggestions());
    submit.mockReset();

    act(() => result.current.onInputChange("ZZ"));
    unmount();
    flushDebounce();

    expect(submit).not.toHaveBeenCalled();
  });

  it("maps the response to picker suggestions", () => {
    firstPageData = SEARCH_RESULT;

    const { result } = renderHook(() => useTagSuggestions());

    expect(result.current.suggestions).toEqual([
      { label: "ZZ Test Tag", value: "t-zz" },
    ]);
  });

  it("keeps the last list and reports the error when a search fails", () => {
    const { result, rerender } = renderHook(() => useTagSuggestions());
    act(() => result.current.onInputChange("ZZ"));
    flushDebounce();
    searchData = SEARCH_RESULT;
    rerender();

    searchData = { error: { message: "Request timed out" } };
    rerender();

    expect(result.current.suggestions).toEqual([
      { label: "ZZ Test Tag", value: "t-zz" },
    ]);
    expect(result.current.error).toBe("Request timed out");
  });

  it("is searching while a typed search runs", () => {
    const { result, rerender } = renderHook(() => useTagSuggestions());
    act(() => result.current.onInputChange("ZZ"));
    flushDebounce();

    searchState = "loading";
    rerender();
    expect(result.current.isSearching).toBe(true);

    searchState = "idle";
    searchData = SEARCH_RESULT;
    rerender();
    expect(result.current.isSearching).toBe(false);
  });

  it("is searching while the request runs", () => {
    firstPageState = "loading";

    const { result } = renderHook(() => useTagSuggestions());

    expect(result.current.isSearching).toBe(true);
  });

  it("shows the first page at once when the box is cleared", () => {
    firstPageData = FIRST_PAGE;
    const { result, rerender } = renderHook(() => useTagSuggestions());

    act(() => result.current.onInputChange("ZZ"));
    flushDebounce();
    searchData = SEARCH_RESULT;
    rerender();
    expect(result.current.suggestions.map((s) => s.value)).toEqual(["t-zz"]);

    // The picker clears its input after each pick.
    act(() => result.current.onInputChange(""));

    expect(result.current.suggestions.map((s) => s.value)).toEqual([
      "t-a",
      "t-b",
    ]);
    expect(result.current.isSearching).toBe(false);
  });

  it("never shows a late search result as the first page", () => {
    firstPageData = FIRST_PAGE;
    const { result, rerender } = renderHook(() => useTagSuggestions());

    act(() => result.current.onInputChange("ZZ"));
    flushDebounce();
    act(() => result.current.onInputChange(""));
    // The search answers after the box was cleared.
    searchData = SEARCH_RESULT;
    rerender();

    expect(result.current.suggestions.map((s) => s.value)).toEqual([
      "t-a",
      "t-b",
    ]);
  });
});

describe("TagsAutocomplete with useTagSuggestions", () => {
  function Picker() {
    const { suggestions, onInputChange, isSearching } = useTagSuggestions({
      useFor: "ASSET",
    });
    return (
      <form>
        <TagsAutocomplete
          existingTags={[]}
          suggestions={suggestions}
          onInputChange={onInputChange}
          noOptionsText={isSearching ? TAG_SEARCHING_TEXT : undefined}
        />
      </form>
    );
  }

  /** The value of the hidden input the bulk dialogs submit. */
  function submittedTags(container: HTMLElement) {
    return (
      container.querySelector(
        'input[type="hidden"][name="tags"]'
      ) as HTMLInputElement | null
    )?.value;
  }

  it("typing in the picker searches the server", () => {
    render(<Picker />);
    submit.mockReset();

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "Test" },
    });
    flushDebounce();

    expect(sentQueries()).toEqual(["Test"]);
  });

  it("keeps a picked tag when a new search no longer returns it", () => {
    firstPageData = SEARCH_RESULT;
    const { container, rerender } = render(<Picker />);

    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ZZ" } });
    // Pick it the way a keyboard user does: highlight, then Enter.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(submittedTags(container)).toBe("t-zz");

    // A different search: the picked tag is not in the new suggestions.
    fireEvent.change(input, { target: { value: "Audio" } });
    flushDebounce();
    searchData = FIRST_PAGE;
    rerender(<Picker />);

    expect(submittedTags(container)).toBe("t-zz");
  });
});
