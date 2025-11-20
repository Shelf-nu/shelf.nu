import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { locationDescendantsMock } from "@mocks/location-descendants";

// why: mocking location descendants to avoid database queries during tests
vi.mock("~/modules/location/descendants.server", () => locationDescendantsMock);

import { db } from "~/database/db.server";
import { getDateTimeFormat } from "~/utils/client-hints";
import { requirePermission } from "~/utils/roles.server";

// why: verifying CSV loader behavior without executing real permission checks
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: controlling Prisma responses for asset activity CSV loader tests
vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findFirstOrThrow: vi.fn(),
    },
    note: {
      findMany: vi.fn(),
    },
  },
}));

// why: stabilizing date formatting output for CSV assertions
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

let loader: (typeof import("~/routes/_layout+/assets.$assetId.activity[.csv]"))["loader"];
const requirePermissionMock = vi.mocked(requirePermission);
const getDateTimeFormatMock = vi.mocked(getDateTimeFormat);
const dbMock = db as unknown as {
  asset: { findFirstOrThrow: ReturnType<typeof vi.fn> };
  note: { findMany: ReturnType<typeof vi.fn> };
};

beforeAll(async () => {
  ({ loader } = await import(
    "~/routes/_layout+/assets.$assetId.activity[.csv]"
  ));
});

describe("app/routes/_layout+/assets.$assetId.activity[.csv] loader", () => {
  const context = {
    getSession: () => ({ userId: "user-123" }),
  } as LoaderFunctionArgs["context"];

  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-1",
    } as any);
    dbMock.asset.findFirstOrThrow.mockResolvedValue({
      id: "asset-123",
      title: "Test Asset",
    });
    dbMock.note.findMany.mockResolvedValue([
      {
        id: "note-1",
        content: 'Line with "quotes"\nand newline',
        type: "COMMENT",
        createdAt: new Date("2024-01-02T10:00:00.000Z"),
        user: { firstName: "Carlos", lastName: "Virreira" },
      },
      {
        id: "note-2",
        content: "System note",
        type: "UPDATE",
        createdAt: new Date("2024-01-01T09:30:00.000Z"),
        user: null,
      },
    ] as any);
    getDateTimeFormatMock.mockReturnValue({
      format: (date: Date) => `formatted-${date.toISOString()}`,
    } as Intl.DateTimeFormat);
  });

  it("returns a CSV response with formatted asset notes", async () => {
    const response = await loader({
      context,
      request: new Request("https://example.com/assets/asset-123/activity.csv"),
      params: { assetId: "asset-123" },
    } as LoaderFunctionArgs);

    expect(requirePermissionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: "user-123",
        request: expect.any(Request),
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      })
    );
    expect(requirePermissionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "user-123",
        request: expect.any(Request),
        entity: PermissionEntity.note,
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
    ).toContain("Test Asset-activity");

    const csv = await (response as unknown as Response).text();
    const rows = csv.trim().split("\n");
    expect(rows[0]).toBe("Date,Author,Type,Content");
    expect(rows[1]).toBe(
      '"formatted-2024-01-02T10:00:00.000Z","Carlos Virreira","COMMENT","Line with ""quotes""\\nand newline"'
    );
    expect(rows[2]).toBe(
      '"formatted-2024-01-01T09:30:00.000Z","","UPDATE","System note"'
    );
  });
});
