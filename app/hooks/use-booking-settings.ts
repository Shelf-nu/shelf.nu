import type { BookingSettings } from "@prisma/client";
import { useRouteLoaderData } from "react-router";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";

/**
 * This base hook is used to access the booking settings from within the _layout route
 */
export function useBookingSettings() {
  let bookingSettings = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  )?.bookingSettings as BookingSettings; // We can be sure this is not undefined because our get function creates the object if it doesn't exist

  return bookingSettings;
}
