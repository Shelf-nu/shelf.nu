/**
 * Explicit Check-out And Check-in Requirement
 *
 * A workspace can require the explicit flow (scan or select the assets) for
 * the roles its switches cover, in either direction. For a covered caller the
 * one-click actions are refused: "Check out", "Check out remaining" and
 * "Check in" on the web booking page and on the bookings list (row buttons
 * and bulk actions), "Check Out All Assets" in the mobile app. Scanning or
 * selecting stays open, and so does the fulfil-and-check-out scanner, which
 * under the requirement checks out only the scanned units (`fulfilAndCheckOut`).
 *
 * Which switch covers a caller is the policy's `bookings.explicitScanSetting`,
 * read through `isExplicitScanRequired`, the same helper the client controls
 * use to hide what the server refuses.
 *
 * @see {@link file://./../../components/booking/explicit-checkout-settings.tsx} - the setting
 * @see {@link file://./../../components/booking/checkout-dropdown.tsx} - the web control it shapes
 * @see {@link file://./../../components/booking/list-row-check-in-out.tsx} - the bookings-list row buttons
 */
import { ShelfError } from "~/utils/error";
import type {
  ExplicitScanSettings,
  RoleAccess,
} from "~/utils/permissions/role-access";
import { isExplicitScanRequired } from "~/utils/permissions/role-access";

/** What each direction's refusal says. */
const QUICK_ACTION_REFUSALS = {
  checkout: {
    title: "Not allowed to quick check-out",
    message:
      "Explicit check-out is required in this organization. Please scan or select the assets to check them out.",
  },
  checkin: {
    title: "Not allowed to quick check-in",
    message:
      "Explicit check-in is required in this organization. Please use the explicit check-in scanner.",
  },
} as const;

/**
 * Refuses a web one-click action when the workspace requires the explicit
 * flow for this caller in that direction.
 *
 * @param args.access - The caller's access
 * @param args.bookingSettings - The workspace's explicit check-out/in switches
 * @param args.direction - Which pair of switches to read
 * @throws {ShelfError} 403 when the explicit flow is required
 */
function assertQuickActionAllowed({
  access,
  bookingSettings,
  direction,
}: {
  access: RoleAccess;
  bookingSettings: ExplicitScanSettings;
  direction: "checkout" | "checkin";
}): void {
  if (
    !isExplicitScanRequired({ access, settings: bookingSettings, direction })
  ) {
    return;
  }
  throw new ShelfError({
    cause: null,
    ...QUICK_ACTION_REFUSALS[direction],
    status: 403,
    label: "Booking",
    shouldBeCaptured: false,
  });
}

/**
 * Refuses the web one-click check-out ("Check out" and "Check out remaining"
 * on the booking page, the bookings-list row and the bulk action) when the
 * workspace requires the explicit check-out flow for this caller.
 *
 * @param args.access - The caller's access
 * @param args.bookingSettings - The workspace's explicit check-out/in switches
 * @throws {ShelfError} 403 when the explicit check-out flow is required
 */
export function assertQuickCheckoutAllowed(args: {
  access: RoleAccess;
  bookingSettings: ExplicitScanSettings;
}): void {
  assertQuickActionAllowed({ ...args, direction: "checkout" });
}

/**
 * Refuses the web one-click check-in ("Check in" on the booking page, the
 * bookings-list row and the bulk action) when the workspace requires the
 * explicit check-in flow for this caller.
 *
 * @param args.access - The caller's access
 * @param args.bookingSettings - The workspace's explicit check-out/in switches
 * @throws {ShelfError} 403 when the explicit check-in flow is required
 */
export function assertQuickCheckinAllowed(args: {
  access: RoleAccess;
  bookingSettings: ExplicitScanSettings;
}): void {
  assertQuickActionAllowed({ ...args, direction: "checkin" });
}
