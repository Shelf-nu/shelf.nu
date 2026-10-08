/**
 * Explicit Check-out Requirement
 *
 * A workspace can require the explicit check-out flow (scan or select the
 * assets) for the roles its switches cover. For a covered caller the one-click
 * check-out is refused: "Check out" and "Check out remaining" on the web
 * booking page, "Check Out All Assets" in the mobile app. Scanning or selecting
 * stays open, and so does the fulfil-and-check-out scanner, which under the
 * requirement checks out only the scanned units (`fulfilAndCheckOut`).
 *
 * Which switch covers a caller is the policy's `bookings.explicitScanSetting`,
 * read through `isExplicitScanRequired`, the same helper the check-in paths
 * use.
 *
 * @see {@link file://./../../components/booking/explicit-checkout-settings.tsx} - the setting
 * @see {@link file://./../../components/booking/checkout-dropdown.tsx} - the web control it shapes
 */
import { ShelfError } from "~/utils/error";
import type {
  ExplicitScanSettings,
  RoleAccess,
} from "~/utils/permissions/role-access";
import { isExplicitScanRequired } from "~/utils/permissions/role-access";

/**
 * Refuses the web one-click check-out ("Check out" and "Check out remaining")
 * when the workspace requires the explicit flow for this caller.
 *
 * @param args.access - The caller's access
 * @param args.bookingSettings - The workspace's explicit check-out/in switches
 * @throws {ShelfError} 403 when the explicit check-out flow is required
 */
export function assertQuickCheckoutAllowed({
  access,
  bookingSettings,
}: {
  access: RoleAccess;
  bookingSettings: ExplicitScanSettings;
}): void {
  if (
    isExplicitScanRequired({
      access,
      settings: bookingSettings,
      direction: "checkout",
    })
  ) {
    throw new ShelfError({
      cause: null,
      title: "Not allowed to quick check-out",
      message:
        "Explicit check-out is required in this organization. Please scan or select the assets to check them out.",
      status: 403,
      label: "Booking",
      shouldBeCaptured: false,
    });
  }
}
