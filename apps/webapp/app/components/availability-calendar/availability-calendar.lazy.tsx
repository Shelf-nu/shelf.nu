/**
 * Lazy Availability Calendar
 *
 * The availability view of the asset and kit indexes renders FullCalendar's
 * resource timeline, and with it luxon. Most visits never switch to that view,
 * so the calendar loads only when it first renders, instead of with every
 * index page.
 *
 * Nothing in this file may import `./availability-calendar` statically: that
 * would put the calendar back into the page's first load.
 *
 * @see {@link file://./availability-calendar.tsx}
 * @see {@link file://./../assets/assets-index/assets-list.tsx}
 * @see {@link file://./../../routes/_layout+/kits._index.tsx}
 */
import { lazy } from "react";
import type { ComponentProps } from "react";
import type AvailabilityCalendar from "./availability-calendar";
import { LazyLoadBoundary } from "../shared/lazy-load-boundary";
import { Spinner } from "../shared/spinner";

const LazyCalendar = lazy(() => import("./availability-calendar"));

/** Shown while the calendar chunk downloads. */
function CalendarChunkLoading() {
  return (
    <div className="flex flex-col items-center gap-4 py-[300px]">
      <Spinner className="size-8" />
      <p className="text-sm text-gray-600">Loading calendar...</p>
    </div>
  );
}

/** Shown if the calendar chunk fails to download. */
function CalendarChunkFailed() {
  return (
    <p className="py-[300px] text-center text-sm text-error-500">
      The calendar could not be loaded. Reload the page and try again.
    </p>
  );
}

/**
 * {@link AvailabilityCalendar}, loaded on first render.
 *
 * @param props - The same props as the calendar itself
 * @returns The calendar, or a placeholder while it loads or if it failed to
 */
export function LazyAvailabilityCalendar(
  props: ComponentProps<typeof AvailabilityCalendar>
) {
  return (
    <LazyLoadBoundary
      loading={<CalendarChunkLoading />}
      failed={<CalendarChunkFailed />}
    >
      <LazyCalendar {...props} />
    </LazyLoadBoundary>
  );
}
