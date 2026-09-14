import type { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";

/**
 * Factory for the `BookingSettings` shape `getBookingSettingsForOrganization`
 * returns (its `BOOKING_SETTINGS_SELECT` projection).
 *
 * Route tests mock that service. Building the full shape here keeps each mock
 * typed against the real return type, so a column added to the select fails
 * the build instead of reaching a route as `undefined`. Every switch defaults
 * to off, matching the database defaults.
 *
 * @see {@link file://./../../app/modules/booking-settings/service.server.ts}
 */

/** The workspace booking settings as the service returns them. */
export type BookingSettingsFixture = Awaited<
  ReturnType<typeof getBookingSettingsForOrganization>
>;

/**
 * Builds workspace booking settings for tests.
 *
 * @param overrides - Fields to change from the defaults
 * @returns A complete settings object in the service's return shape
 */
export function createBookingSettings(
  overrides: Partial<BookingSettingsFixture> = {}
): BookingSettingsFixture {
  return {
    id: "booking-settings-1",
    bufferStartTime: 0,
    maxBookingLength: null,
    maxBookingLengthSkipClosedDays: false,
    tagsRequired: false,
    autoArchiveBookings: false,
    autoArchiveDays: 2,
    autoArchiveExpiredReservations: false,
    requireExplicitCheckinForAdmin: false,
    requireExplicitCheckinForSelfService: false,
    requireExplicitCheckoutForAdmin: false,
    requireExplicitCheckoutForSelfService: false,
    countKitsAsSingleUnit: false,
    notifyBookingCreator: true,
    notifyAdminsOnNewBooking: true,
    alwaysNotifyTeamMembers: [],
    ...overrides,
  };
}
