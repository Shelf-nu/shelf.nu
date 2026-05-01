import { useRouteLoaderData } from "react-router";
import type { LayoutLoaderResponse } from "~/routes/_layout+/_layout";

/**
 * Derives the booking settings type from the layout loader response rather
 * than using the raw Prisma model type directly. This is intentional because
 * the loader's `select` clause returns a subset of the model with specific
 * nested relations (e.g. `alwaysNotifyTeamMembers` with user details) that
 * differ from the full Prisma model shape. Deriving from the loader ensures
 * type-safety matches what the client actually receives.
 */
type LayoutData = ReturnType<typeof useRouteLoaderData<LayoutLoaderResponse>>;
type BookingSettingsLoaderData = NonNullable<
  NonNullable<LayoutData>["bookingSettings"]
>;

/**
 * This base hook is used to access the booking settings from within the _layout route
 */
export function useBookingSettings() {
  const bookingSettings = useRouteLoaderData<LayoutLoaderResponse>(
    "routes/_layout+/_layout"
  )?.bookingSettings as BookingSettingsLoaderData; // We can be sure this is not undefined because our get function creates the object if it doesn't exist

  return bookingSettings;
}
