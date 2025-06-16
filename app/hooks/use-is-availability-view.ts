import { useSearchParams } from "./search-params";

/**
 * Hook to determine if the current view is the availability view.
 * @returns `true` if the current view is the availability view, `false` otherwise.
 */
export function useIsAvailabilityView() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get("view") ?? "table";
  return view === "availability";
}
