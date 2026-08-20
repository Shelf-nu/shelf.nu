import type { ChangeEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigation } from "react-router";

import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import type { SearchableIndexResponse } from "~/modules/types";
import { isSearching } from "~/utils/form";
import { tw } from "~/utils/tw";
import { SearchFieldTooltip } from "./search-field-tooltip";

/**
 * How long to wait after the last keystroke before pushing the search term
 * into the URL.
 *
 * Every change to `?s=` is a router navigation, and each navigation issues one
 * single-fetch `*.data` request. Without a delay that is literally one
 * server-side loader run PER CHARACTER — which both hammers the database and
 * trips `appLoaderRateLimit` (`server/rate-limit.ts`: 60 `.data` requests per
 * 60s per `(userId, path)`, with the query string deliberately excluded from
 * the bucket key, so every `?s=` variant shares one budget). Typing ~60
 * characters into a list search within a minute was enough to earn a 429 and
 * the "Too many requests" error boundary, which is what customers hit on the
 * booking manage-kits/manage-assets modals.
 *
 * 400ms is the usual search-as-you-type range: long enough to collapse a
 * word into a single request, short enough to still feel live.
 *
 * NOTE: a 100ms debounce previously existed here and was removed in
 * `a1f6cd734` because it broke the loading indicator. That regression is
 * avoided below by driving the spinner off `isBusy` (pending debounce OR
 * in-flight navigation) rather than off navigation state alone — do not
 * "simplify" it back to `isSearching(navigation)`.
 */
const SEARCH_DEBOUNCE_MS = 400;

export const SearchForm = ({ className }: { className?: string }) => {
  const [_searchParams, setSearchParams] = useSearchParams();
  const { search, modelName, searchFieldLabel } =
    useLoaderData<SearchableIndexResponse>();
  const { singular } = modelName;
  const { modeIsAdvanced } = useAssetIndexViewState();

  const navigation = useNavigation();
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** Pending debounce timer, or `null` when nothing is scheduled. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * True between the keystroke and the debounced navigation firing. Exists so
   * the search field can show its spinner immediately — see
   * {@link SEARCH_DEBOUNCE_MS}.
   */
  const [isDebouncePending, setIsDebouncePending] = useState(false);

  /** Cancel any scheduled search navigation and clear the pending flag. */
  const cancelPendingSearch = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setIsDebouncePending(false);
  }, []);

  // Don't fire a navigation (or set state) after the field has unmounted —
  // these modals close while a debounce can still be in flight.
  useEffect(
    () => () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    },
    []
  );

  const label = searchFieldLabel ? searchFieldLabel : `Search by ${singular}`;

  /**
   * Clears the search parameter and page parameter from the URL
   * to ensure we start from the first page of results.
   *
   * Runs immediately (no debounce) — clearing is an explicit, single action,
   * and any keystroke-scheduled navigation is cancelled first so a stale term
   * can't land after the field has been emptied.
   */
  const clearSearch = useCallback(() => {
    cancelPendingSearch();
    setSearchParams(
      (prev) => {
        prev.delete("s");
        prev.delete("page"); // Reset page when clearing search
        return prev;
      },
      { replace: true }
    );
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
  }, [cancelPendingSearch, setSearchParams]);

  /**
   * Handles search input changes, debounced so a burst of typing produces ONE
   * navigation instead of one per character.
   *
   * `replace: true` keeps search-as-you-type out of the history stack — before
   * this, every character pushed an entry, so Back walked the user backwards
   * through their own query one letter at a time.
   */
  const handleSearchChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const searchQuery = e.target.value;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    setIsDebouncePending(true);

    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setIsDebouncePending(false);

      if (!searchQuery) {
        clearSearch();
        return;
      }

      setSearchParams(
        (prev) => {
          prev.set("s", searchQuery);
          prev.delete("page"); // Reset to page 1 when search query changes
          return prev;
        },
        { replace: true }
      );
    }, SEARCH_DEBOUNCE_MS);
  };

  /**
   * Busy from the first keystroke through to the navigation settling, so the
   * debounce window is never a dead, unresponsive gap.
   */
  const isBusy = isDebouncePending || isSearching(navigation);

  return (
    <div className={tw("flex w-full md:w-auto", className)}>
      <div className="relative flex-1">
        <Input
          type="text"
          name="s"
          label={label}
          aria-label={label}
          placeholder={label}
          defaultValue={search || ""}
          hideLabel
          className="w-full md:w-auto"
          inputClassName={tw(modeIsAdvanced ? "py-2 text-sm" : "", "pr-9")}
          ref={searchInputRef}
          onChange={handleSearchChange}
        />
        {search || isBusy ? (
          <Button
            type="button"
            icon={isBusy ? "spinner" : "x"}
            variant="tertiary"
            disabled={isBusy}
            // `title` alone is only the last-resort fallback in the accessible
            // -name computation, and the shared Button treats an icon-only
            // control without aria-label/label/tooltip as unnamed (it warns in
            // dev). Keep `title` for the visual tooltip, name it explicitly for
            // assistive tech. Static on purpose — the control is still "clear
            // search" while it spins.
            aria-label="Clear search"
            title="Clear search"
            className="absolute right-3.5 top-1/2 !w-auto -translate-y-1/2 cursor-pointer border-0 p-0 text-gray-400 hover:text-gray-700"
            onClick={clearSearch}
          />
        ) : (
          <SearchFieldTooltip />
        )}
      </div>
    </div>
  );
};
