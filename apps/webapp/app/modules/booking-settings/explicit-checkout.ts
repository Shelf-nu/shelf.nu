/**
 * Explicit Check-out Requirement
 *
 * A workspace can require the explicit check-out flow (scan or select the
 * assets) for Admins, for Self Service users, or for both. For a covered role
 * the one-click check-out is refused: "Check out" and "Check out remaining" on
 * the web booking page, "Check Out All Assets" in the mobile app. Scanning or
 * selecting the assets, and the fulfil-and-check-out scanner, stay open.
 *
 * OWNER is always exempt and BASE is not covered, the same as the explicit
 * check-in requirement. Pass the membership's most privileged role
 * (`requirePermission`'s `role` on the web, `effectiveRole` from
 * `getMobileUserContext` on mobile), never `roles[0]`: a membership can hold
 * several roles.
 *
 * @see {@link file://./../../components/booking/explicit-checkout-settings.tsx} - the setting
 * @see {@link file://./../../components/booking/checkout-dropdown.tsx} - the web control it shapes
 */
import type { BookingSettings } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { ShelfError } from "~/utils/error";

/** The two booking settings the requirement reads. */
export type ExplicitCheckoutSettings = Pick<
  BookingSettings,
  "requireExplicitCheckoutForAdmin" | "requireExplicitCheckoutForSelfService"
>;

/**
 * Whether the workspace requires the explicit check-out flow for this role.
 *
 * @param args.role - The membership's most privileged role
 * @param args.bookingSettings - The workspace's explicit check-out switches
 * @returns `true` when the one-click check-out must be refused for this role
 */
export function isExplicitCheckoutRequired({
  role,
  bookingSettings,
}: {
  role: OrganizationRoles;
  bookingSettings: ExplicitCheckoutSettings;
}): boolean {
  switch (role) {
    case OrganizationRoles.ADMIN:
      return bookingSettings.requireExplicitCheckoutForAdmin;
    case OrganizationRoles.SELF_SERVICE:
      return bookingSettings.requireExplicitCheckoutForSelfService;
    default:
      // OWNER is exempt and BASE is not covered.
      return false;
  }
}

/**
 * Refuses the web one-click check-out ("Check out" and "Check out remaining")
 * when the workspace requires the explicit flow for this role.
 *
 * @param args.role - The membership's most privileged role
 * @param args.bookingSettings - The workspace's explicit check-out switches
 * @throws {ShelfError} 403 when the explicit check-out flow is required
 */
export function assertQuickCheckoutAllowed(args: {
  role: OrganizationRoles;
  bookingSettings: ExplicitCheckoutSettings;
}): void {
  if (isExplicitCheckoutRequired(args)) {
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
