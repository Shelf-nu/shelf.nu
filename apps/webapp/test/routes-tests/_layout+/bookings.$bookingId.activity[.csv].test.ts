import type { LoaderFunctionArgs } from "react-router";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";
import { locationDescendantsMock } from "@mocks/location-descendants";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

import { db } from "~/database/db.server";
import { getDateTimeFormat } from "~/utils/client-hints";
import { requirePermission } from "~/utils/roles.server";

// why: verifying booking note CSV loader without triggering actual permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: providing deterministic Prisma responses for booking activity CSV tests
vi.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findFirstOrThrow: vi.fn(),
    },
    bookingNote: {
      findMany: vi.fn(),
    },
    // why: exportNotesToCsv now resolves the acting user's format prefs via
    // resolveUserFormatPrefsById (db.user.findFirst). null → HARDCODED_DEFAULT_PREFS.
    user: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

// why: ensuring predictable timestamp formatting in CSV output assertions
vi.mock("~/utils/client-hints", async () => {
  const actual = await vi.importActual<typeof import("~/utils/client-hints")>(
    "~/utils/client-hints"
  );

  return {
    ...actual,
    getDateTimeFormat: vi.fn(),
  };
});

// why: suppress lottie animation initialization during route import
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

let loader: (typeof import("~/routes/_layout+/bookings.$bookingId.activity[.csv]"))["loader"];
const requirePermissionMock = vi.mocked(requirePermission);
const getDateTimeFormatMock = vi.mocked(getDateTimeFormat);
const dbMock = db as unknown as {
  booking: { findFirstOrThrow: ReturnType<typeof vi.fn> };
  bookingNote: { findMany: ReturnType<typeof vi.fn> };
};

beforeAll(async () => {
  ({ loader } = await import(
    "~/routes/_layout+/bookings.$bookingId.activity[.csv]"
  ));
});

describe("app/routes/_layout+/bookings.$bookingId.activity[.csv] loader", () => {
  const context = {
    getSession: () => ({ userId: "user-456" }),
  } as LoaderFunctionArgs["context"];

  beforeEach(() => {
    vi.clearAllMocks();
    // `canSeeAllBookings: true` models the admin/owner case these formatting
    // assertions are about. The route also gates self-service/base callers to
    // their own bookings; that gate has its own test below.
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-9",
      canSeeAllBookings: true,
    } as any);
    dbMock.booking.findFirstOrThrow.mockResolvedValue({
      id: "booking-789",
      name: "Field Shoot",
      custodianUserId: "someone-else",
    });
    dbMock.bookingNote.findMany.mockResolvedValue([
      {
        id: "booking-note-1",
        content: 'Packed "Lens" set\nVerify inventory',
        type: "COMMENT",
        createdAt: new Date("2024-02-10T08:15:00.000Z"),
        user: { firstName: "Alex", lastName: "Stone" },
      },
      {
        id: "booking-note-2",
        content: "System update",
        type: "UPDATE",
        createdAt: new Date("2024-02-09T12:00:00.000Z"),
        user: null,
      },
    ] as any);
    getDateTimeFormatMock.mockReturnValue({
      format: (date: Date) => `formatted-${date.toISOString()}`,
    } as Intl.DateTimeFormat);
  });

  it("returns a CSV response with formatted booking notes", async () => {
    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/bookings/booking-789/activity.csv"
        ),
        params: { bookingId: "booking-789" },
      })
    );

    expect(requirePermissionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-456",
        request: expect.any(Request),
        entity: PermissionEntity.booking,
        action: PermissionAction.read,
      })
    );
    expect(requirePermissionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "user-456",
        request: expect.any(Request),
        entity: PermissionEntity.bookingNote,
        action: PermissionAction.read,
      })
    );

    // Loader returns Response for success
    expect(response instanceof Response).toBe(true);
    expect((response as unknown as Response).status).toBe(200);
    expect((response as unknown as Response).headers.get("content-type")).toBe(
      "text/csv"
    );
    expect(
      (response as unknown as Response).headers.get("content-disposition")
    ).toContain("Field Shoot-activity");

    const csv = await (response as unknown as Response).text();
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("Date,Author,Type,Content");
    expect(rows[1]).toBe(
      '"02/10/2024, 8:15 AM","Alex Stone","COMMENT","Packed ""Lens"" set Verify inventory"'
    );
    expect(rows[2]).toBe('"02/09/2024, 12:00 PM","","UPDATE","System update"');
  });

  /**
   * Both permission checks the loader makes (`booking.read` and
   * `bookingNote.read`) are granted to BASE and SELF_SERVICE, so the
   * organization scope alone left this export readable for any booking in the
   * workspace by id.
   */
  it("refuses to export another user's booking for a caller who cannot see all bookings", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-9",
      canSeeAllBookings: false,
    } as any);
    dbMock.booking.findFirstOrThrow.mockResolvedValue({
      id: "booking-789",
      name: "Field Shoot",
      custodianUserId: "someone-else",
    });

    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/bookings/booking-789/activity.csv"
        ),
        params: { bookingId: "booking-789" },
      })
    );

    // The route catches and returns `data(error(...), { status })` rather than
    // a CSV Response.
    expect(response instanceof Response).toBe(false);
    expect((response as any).init?.status).toBe(403);
  });

  it("exports the caller's own booking when they cannot see all bookings", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-9",
      canSeeAllBookings: false,
    } as any);
    dbMock.booking.findFirstOrThrow.mockResolvedValue({
      id: "booking-789",
      name: "Field Shoot",
      custodianUserId: "user-456",
    });

    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/bookings/booking-789/activity.csv"
        ),
        params: { bookingId: "booking-789" },
      })
    );

    expect(response instanceof Response).toBe(true);
    expect((response as unknown as Response).status).toBe(200);
  });

  /**
   * Custody can live on the team-member link alone (assigned before a user was
   * attached to the team member, linked only when the invite was accepted).
   * The bookings index and its CSV export both match either link, so refusing
   * the row here would export a booking list containing rows whose own
   * activity export 403s.
   */
  it("exports a legacy booking held via the caller's team-member link alone", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-9",
      canSeeAllBookings: false,
    } as any);
    dbMock.booking.findFirstOrThrow.mockResolvedValue({
      id: "booking-789",
      name: "Field Shoot",
      custodianUserId: null,
      custodianTeamMember: { userId: "user-456" },
    });

    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/bookings/booking-789/activity.csv"
        ),
        params: { bookingId: "booking-789" },
      })
    );

    expect(response instanceof Response).toBe(true);
    expect((response as unknown as Response).status).toBe(200);
  });

  it("refuses to export a booking whose team-member link belongs to another user", async () => {
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-9",
      canSeeAllBookings: false,
    } as any);
    dbMock.booking.findFirstOrThrow.mockResolvedValue({
      id: "booking-789",
      name: "Field Shoot",
      custodianUserId: null,
      custodianTeamMember: { userId: "someone-else" },
    });

    const response = await loader(
      createLoaderArgs({
        context,
        request: new Request(
          "https://example.com/bookings/booking-789/activity.csv"
        ),
        params: { bookingId: "booking-789" },
      })
    );

    expect(response instanceof Response).toBe(false);
    expect((response as any).init?.status).toBe(403);
  });
});
