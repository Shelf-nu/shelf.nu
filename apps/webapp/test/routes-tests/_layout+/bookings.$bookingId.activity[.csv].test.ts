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
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-9",
    } as any);
    dbMock.booking.findFirstOrThrow.mockResolvedValue({
      id: "booking-789",
      name: "Field Shoot",
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
      '"formatted-2024-02-10T08:15:00.000Z","Alex Stone","COMMENT","Packed ""Lens"" set Verify inventory"'
    );
    expect(rows[2]).toBe(
      '"formatted-2024-02-09T12:00:00.000Z","","UPDATE","System update"'
    );
  });
});
