/**
 * Route tests for `/bookings/:bookingId/overview/duplicate`.
 *
 * `booking:create` is the matrix gate and every role holds it, so it settles
 * nothing about the SOURCE booking. These tests pin the two places the route
 * holds the source to the caller's reach:
 *
 * - The loader answers its own data requests, independent of the booking
 *   page's loader, so it refuses a source the caller may not duplicate before
 *   returning any of it.
 * - The action hands the caller's access to `duplicateBooking`, which runs the
 *   guard on the same row the copy is built from (covered in the service
 *   tests). The rule itself is unit-tested on `assertCanDuplicateBooking`.
 *
 * @see {@link file://../../../app/routes/_layout+/bookings.$bookingId.overview.duplicate.tsx}
 * @see {@link file://../../../app/utils/booking-authorization.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";
import { createActionArgs, createLoaderArgs } from "@mocks/remix";

import {
  computeBookingKitDrift,
  duplicateBooking,
  getBooking,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import {
  action,
  loader,
} from "~/routes/_layout+/bookings.$bookingId.overview.duplicate";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

// why: the booking reads and the copy are the service's concern; these tests
// assert only what the route lets through.
vi.mock("~/modules/booking/service.server", () => ({
  duplicateBooking: vi.fn(),
  getBooking: vi.fn(),
  computeBookingKitDrift: vi.fn(),
}));

// why: the action validates dates against workspace settings; the tests need
// a permissive window, not the database.
vi.mock("~/modules/booking-settings/service.server", () => ({
  getBookingSettingsForOrganization: vi.fn(),
}));
vi.mock("~/modules/working-hours/service.server", () => ({
  getWorkingHoursForOrganization: vi.fn(),
}));

// why: date parsing resolves the caller's stored preferences from the
// database; a fixed zone keeps the test hermetic.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(async () => ({
    timeZone: "UTC",
    dateFormat: "MM/dd/yyyy",
    timeFormat: "24h",
    weekStart: 1,
  })),
}));

// why: the action emits a toast over the SSE emitter, which has no listener here.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: permission resolution is mocked so each test can hand the route the
// access of the role under test.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

const ME = "user-1";
const SOMEONE_ELSE = "user-2";

const mockContext = {
  getSession: () => ({ userId: ME }),
  appVersion: "1.0.0",
  isAuthenticated: true,
  setSession: vi.fn(),
  destroySession: vi.fn(),
  errorMessage: null,
} as any;

/** Resolves the permission gate with the given role's access. */
function actAs(role: OrganizationRoles) {
  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    userOrganizations: [{ organizationId: "org-1" }],
    access: accessFor([role]),
  } as any);
}

/** Calls the loader, returning what it answered or threw. */
async function load() {
  try {
    return await loader(
      createLoaderArgs({
        request: new Request(
          "http://localhost/bookings/booking-1/overview/duplicate"
        ),
        params: { bookingId: "booking-1" },
        context: mockContext,
      })
    );
  } catch (thrown) {
    return thrown;
  }
}

describe("bookings.$bookingId.overview.duplicate loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(computeBookingKitDrift).mockResolvedValue([] as never);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "refuses %s another member's booking without returning it",
    async (role) => {
      actAs(role);
      vi.mocked(getBooking).mockResolvedValue({
        id: "booking-1",
        name: "Someone else's booking",
        creatorId: SOMEONE_ELSE,
        custodianUserId: SOMEONE_ELSE,
      } as never);

      const answer = (await load()) as { status?: number };

      expect(answer.status).toBe(403);
      expect(JSON.stringify(answer)).not.toContain("Someone else's booking");
    }
  );

  it("returns the source booking to a caller who may duplicate it", async () => {
    actAs(OrganizationRoles.SELF_SERVICE);
    vi.mocked(getBooking).mockResolvedValue({
      id: "booking-1",
      name: "My booking",
      creatorId: ME,
      custodianUserId: ME,
    } as never);

    const answer = (await load()) as { booking?: { name: string } };

    expect(answer.booking?.name).toBe("My booking");
  });
});

describe("bookings.$bookingId.overview.duplicate action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBookingSettingsForOrganization).mockResolvedValue({
      bufferStartTime: 0,
      maxBookingLength: null,
      maxBookingLengthSkipClosedDays: false,
    } as never);
    vi.mocked(getWorkingHoursForOrganization).mockResolvedValue({
      enabled: false,
      weeklySchedule: {},
      overrides: [],
    } as never);
    vi.mocked(duplicateBooking).mockResolvedValue({
      id: "booking-2",
      name: "My booking (Copy)",
    } as never);
  });

  it("hands the caller's access to the service, which guards the copied row", async () => {
    actAs(OrganizationRoles.SELF_SERVICE);

    await action(
      createActionArgs({
        request: new Request(
          "http://localhost/bookings/booking-1/overview/duplicate",
          {
            method: "POST",
            body: new URLSearchParams({
              startDate: "2099-08-01T09:00",
              endDate: "2099-08-03T17:00",
            }),
          }
        ),
        params: { bookingId: "booking-1" },
        context: mockContext,
      })
    );

    expect(duplicateBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: "booking-1",
        organizationId: "org-1",
        userId: ME,
        access: expect.objectContaining({
          policy: expect.objectContaining({
            bookings: expect.objectContaining({ custodianPicker: "self" }),
          }),
        }),
      })
    );
  });
});
