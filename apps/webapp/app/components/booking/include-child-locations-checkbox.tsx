/**
 * "Include assets from child locations" checkbox for a Locations filter.
 *
 * A Locations filter matches the exact locations ticked. This checkbox is the
 * explicit opt-in that widens each ticked location to everything nested under
 * it. It writes one URL param and nothing else; the loader resolves the param
 * into location ids.
 *
 * It lives in the filter row, beside the Locations dropdown and never inside
 * it: the dropdown lists locations that exist, and a row that changes how the
 * others match would read as one more location.
 *
 * Render it only when a ticked location has child locations. Otherwise it
 * cannot change the result, and an inert control only adds noise.
 *
 * @see {@link file://./../../modules/location/child-locations-filter.ts}
 * @see {@link file://./../../modules/location/child-locations-filter.server.ts}
 */
import { useLocation, useNavigation } from "react-router";
import { useSearchParams } from "~/hooks/search-params";
import {
  INCLUDE_CHILD_LOCATIONS_ON,
  INCLUDE_CHILD_LOCATIONS_PARAM,
  isIncludingChildLocations,
} from "~/modules/location/child-locations-filter";
import { tw } from "~/utils/tw";

const CHECKBOX_ID = "include-child-locations";

/**
 * URL-backed checkbox that turns "include child locations" on or off for the
 * Locations filter of the list it sits beside.
 *
 * @param props.className - Extra classes for the wrapping label
 */
export function IncludeChildLocationsCheckbox({
  className,
}: {
  className?: string;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigation = useNavigation();

  /**
   * The URL only changes once the loader has answered, so reading it alone
   * leaves the box unticked for the length of a request after a click. While
   * a navigation on THIS page is pending, its target URL is the truth. A
   * pending navigation to another page (Close, the Kits tab) says nothing
   * about this filter and is ignored.
   */
  const pendingSearchParams =
    navigation.location?.pathname === pathname
      ? new URLSearchParams(navigation.location.search)
      : null;
  const checked = isIncludingChildLocations(
    pendingSearchParams ?? searchParams
  );

  function handleChange(nextChecked: boolean) {
    setSearchParams(
      (prev) => {
        if (nextChecked) {
          prev.set(INCLUDE_CHILD_LOCATIONS_PARAM, INCLUDE_CHILD_LOCATIONS_ON);
        } else {
          prev.delete(INCLUDE_CHILD_LOCATIONS_PARAM);
        }
        // The result set changes size, so the current page may not exist.
        prev.delete("page");
        return prev;
      },
      { preventScrollReset: true }
    );
  }

  return (
    <label
      htmlFor={CHECKBOX_ID}
      className={tw(
        "flex cursor-pointer select-none items-center gap-2 text-sm",
        className
      )}
    >
      <input
        id={CHECKBOX_ID}
        type="checkbox"
        checked={checked}
        onChange={(event) => handleChange(event.target.checked)}
        className="rounded-sm checked:bg-primary focus-within:ring-primary checked:hover:bg-primary checked:focus:bg-primary"
      />
      <span>Include assets from child locations</span>
    </label>
  );
}
