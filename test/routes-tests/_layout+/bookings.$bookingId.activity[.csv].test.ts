import type { LoaderFunctionArgs } from "@remix-run/node";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    const response = await loader({
      context,
      request: new Request(
        "https://example.com/bookings/booking-789/activity.csv"
      ),
      params: { bookingId: "booking-789" },
    } as LoaderFunctionArgs);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "Field Shoot-activity"
    );

    const csv = await response.text();
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("Date,Author,Type,Content");
    expect(rows[1]).toBe(
      '"formatted-2024-02-10T08:15:00.000Z","Alex Stone","COMMENT","Packed ""Lens"" set\\nVerify inventory"'
    );
    expect(rows[2]).toBe(
      '"formatted-2024-02-09T12:00:00.000Z","","UPDATE","System update"'
    );
  });
});
