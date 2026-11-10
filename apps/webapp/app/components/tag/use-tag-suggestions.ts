/**
 * Tag suggestions for a tag picker, searched on the server as the user types.
 *
 * Used by the bulk "Assign tags" and "Remove tags" dialogs. `/api/model-filters`
 * returns at most one page of tags per request, ordered by name, so a picker
 * that loads the list once can only ever offer that page. This hook loads the
 * first page on mount and re-queries with the typed text (debounced), so any
 * tag in the workspace can be found by name.
 *
 * Pass `onInputChange` to `TagsAutocomplete`, and `noOptionsText` while
 * `isSearching`. Picked tags live in the picker's own state, so they stay
 * selected when the suggestions change.
 *
 * @see {@link file://./tags-autocomplete.tsx}
 * @see {@link file://./../../routes/api+/model-filters.ts}
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { TagUseFor } from "@prisma/client";
import { useFetcher } from "react-router";
import type { TagSuggestion } from "./tags-autocomplete";

/** Shape of the `/api/model-filters` response this hook reads. */
export type TagsFetcherData = {
  filters?: Array<{ name: string; id: string }>;
  error?: { message?: string } | null;
};

/**
 * Wait after the last keystroke before searching, so a typed word costs one
 * request instead of one per character.
 */
export const TAG_SEARCH_DEBOUNCE_MS = 300;

/** Picker text while a search is pending, in place of "No matching Tags". */
export const TAG_SEARCHING_TEXT = "Searching...";

/** Maps a successful response to picker suggestions. */
function toSuggestions(filters: NonNullable<TagsFetcherData["filters"]>) {
  return filters.map((tag) => ({ label: tag.name, value: tag.id }));
}

/**
 * What the box asks for: the search whose results are shown (empty shows the
 * first page), and whether a typed search is still waiting for its debounce.
 */
type SearchState = { query: string; isDebouncePending: boolean };

type SearchAction =
  /** The user typed a search; it runs when the debounce fires. */
  | { type: "typed" }
  /** The box was emptied: show the first page, nothing pending. */
  | { type: "cleared" }
  /** The debounce fired for this search. */
  | { type: "debounceFired"; query: string };

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "typed":
      return { ...state, isDebouncePending: true };
    case "cleared":
      return { query: "", isDebouncePending: false };
    case "debounceFired":
      return { query: action.query, isDebouncePending: false };
  }
}

/**
 * @param useFor - Only offer tags usable for this entity (plus tags usable for
 *   all entities). Omit to offer every tag.
 * @returns `suggestions`, `onInputChange`, `isSearching`, and the `error`
 *   message of the request behind what is shown, if it failed.
 */
export function useTagSuggestions({ useFor }: { useFor?: TagUseFor } = {}) {
  /**
   * Two fetchers, so a response is always known to be the first page or a
   * search result: the first page is loaded once and shown whenever the box
   * is empty; searches run on their own fetcher.
   */
  const firstPageFetcher = useFetcher<TagsFetcherData>();
  const searchFetcher = useFetcher<TagsFetcherData>();

  /** Pending search timer, or `null` when nothing is scheduled. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [{ query, isDebouncePending }, dispatch] = useReducer(searchReducer, {
    query: "",
    isDebouncePending: false,
  });

  /**
   * The last successful search result. Updated from each search response as
   * it arrives (React's "adjust state when a value changes" pattern); a failed
   * search leaves it in place instead of emptying the picker.
   */
  const [lastSearch, setLastSearch] = useState<{
    data: TagsFetcherData | undefined;
    suggestions: TagSuggestion[];
  }>({ data: undefined, suggestions: [] });

  if (searchFetcher.data !== lastSearch.data) {
    const filters = searchFetcher.data?.filters;
    setLastSearch({
      data: searchFetcher.data,
      suggestions: filters ? toSuggestions(filters) : lastSearch.suggestions,
    });
  }

  const firstPageFilters = firstPageFetcher.data?.filters;
  const firstPage = useMemo(
    () => (firstPageFilters ? toSuggestions(firstPageFilters) : []),
    [firstPageFilters]
  );

  /** `submit` changes identity every render; keep the latest here. */
  const submitFirstPageRef = useRef(firstPageFetcher.submit);
  const submitSearchRef = useRef(searchFetcher.submit);
  useEffect(() => {
    submitFirstPageRef.current = firstPageFetcher.submit;
    submitSearchRef.current = searchFetcher.submit;
  });

  const params = useCallback(
    (queryValue: string) => ({
      name: "tag",
      queryKey: "name",
      queryValue,
      ...(useFor ? { useFor } : {}),
    }),
    [useFor]
  );

  useEffect(() => {
    void submitFirstPageRef.current(params(""), {
      method: "GET",
      action: "/api/model-filters",
    });
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [params]);

  const onInputChange = useCallback(
    (value: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const typed = value.trim();

      // An empty box (the picker clears it after each pick) shows the first
      // page straight away, with no request.
      if (typed === "") {
        dispatch({ type: "cleared" });
        return;
      }

      dispatch({ type: "typed" });
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        dispatch({ type: "debounceFired", query: typed });
        void submitSearchRef.current(params(typed), {
          method: "GET",
          action: "/api/model-filters",
        });
      }, TAG_SEARCH_DEBOUNCE_MS);
    },
    [params]
  );

  const activeFetcher = query === "" ? firstPageFetcher : searchFetcher;
  const error =
    activeFetcher.data && !activeFetcher.data.filters
      ? activeFetcher.data.error?.message ?? "Could not search tags"
      : undefined;

  return {
    suggestions: query === "" ? firstPage : lastSearch.suggestions,
    onInputChange,
    isSearching: isDebouncePending || activeFetcher.state !== "idle",
    error,
  };
}
