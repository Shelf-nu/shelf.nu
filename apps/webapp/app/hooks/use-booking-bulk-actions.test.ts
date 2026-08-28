/**
 * Contract for {@link useBookingBulkActions}.
 *
 * Two components read this: the bulk actions menu, which renders the items,
 * and the row checkbox that selects things for them. `hasAny` is what keeps
 * them agreeing, so a checkbox never feeds a menu that renders nothing.
 *
 * @see {@link file://./use-booking-bulk-actions.ts}
 */

import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { renderHook } from "@testing-library/react";
import { useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useBookingBulkActions } from "./use-booking-bulk-actions";
import { useUserRoleHelper } from "./user-user-role-helper";

// why: `useLoaderData` supplies the booking under test; the real hook needs a
// data router this test does not mount.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useLoaderData: vi.fn() };
});

// why: the roles under test. The real hook reads `useRouteLoaderData` for the
// `_layout` route, which is not mounted here.
vi.mock("./user-user-role-helper", () => ({
  useUserRoleHelper: vi.fn(),
}));

const mockedUseLoaderData = vi.mocked(useLoaderData);
const mockedUseUserRoleHelper = vi.mocked(useUserRoleHelper);

function actions(status: BookingStatus, roles: OrganizationRoles[]) {
  mockedUseLoaderData.mockReturnValue({
    booking: { id: "b1", status },
  } as never);
  mockedUseUserRoleHelper.mockReturnValue({ roles } as ReturnType<
    typeof useUserRoleHelper
  >);

  return renderHook(() => useBookingBulkActions()).result.current;
}

describe("useBookingBulkActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // BASE holds `booking:update` but neither check-in nor check-out, and
  // removing from a live booking resets the asset to available, which is a
  // check-in. Nothing is left, so the checkbox has nothing to feed.
  it("gives a BASE custodian nothing on a reserved or live booking", () => {
    for (const status of [
      BookingStatus.RESERVED,
      BookingStatus.ONGOING,
      BookingStatus.OVERDUE,
    ]) {
      const a = actions(status, [OrganizationRoles.BASE]);

      expect({ status, ...a }).toMatchObject({
        showPartialCheckin: false,
        showPartialCheckout: false,
        showRemove: false,
        hasAny: false,
      });
    }
  });

  /**
   * A finished booking is the one case where BASE still sees the row, disabled.
   * Deliberate, and the same answer an admin gets: BASE removes in DRAFT, so on
   * a COMPLETE booking the status really is the only thing in the way and the
   * disabled reason states it correctly. Contrast the live statuses above,
   * where the role is the reason and a status message would misexplain it.
   */
  it("shows a BASE custodian the disabled remove row on a finished booking", () => {
    const a = actions(BookingStatus.COMPLETE, [OrganizationRoles.BASE]);

    expect(a).toMatchObject({
      canRemove: false,
      showRemove: true,
      hasAny: true,
    });
  });

  it("gives a BASE custodian removal on a DRAFT booking", () => {
    const a = actions(BookingStatus.DRAFT, [OrganizationRoles.BASE]);

    expect(a.showRemove).toBe(true);
    expect(a.hasAny).toBe(true);
  });

  // SELF_SERVICE holds both check permissions, so a live booking keeps the
  // menu even though removal has closed.
  it("keeps check-in and check-out for SELF_SERVICE on a live booking", () => {
    const a = actions(BookingStatus.ONGOING, [OrganizationRoles.SELF_SERVICE]);

    expect(a).toMatchObject({
      showPartialCheckin: true,
      showPartialCheckout: true,
      showRemove: false,
      hasAny: true,
    });
  });

  it("keeps removal visible for ADMIN on a finished booking, to be disabled", () => {
    const a = actions(BookingStatus.COMPLETE, [OrganizationRoles.ADMIN]);

    expect(a).toMatchObject({ canRemove: false, showRemove: true });
  });

  /**
   * All three closed statuses are the same answer to the user, so they get the
   * same disabled row and reason. Singling out COMPLETE and ARCHIVED left a
   * cancelled booking dropping the row with nothing said.
   */
  it.each([
    BookingStatus.COMPLETE,
    BookingStatus.ARCHIVED,
    BookingStatus.CANCELLED,
  ])("explains rather than hides removal on a %s booking", (status) => {
    const a = actions(status, [OrganizationRoles.ADMIN]);

    expect(a).toMatchObject({ canRemove: false, showRemove: true });
  });

  // The finished-booking fallback above must not fire before roles resolve.
  it("gives nothing when roles have not loaded", () => {
    expect(actions(BookingStatus.COMPLETE, []).hasAny).toBe(false);
    expect(actions(BookingStatus.ONGOING, []).hasAny).toBe(false);
  });
});
