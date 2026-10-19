// @vitest-environment node
/**
 * `GET /api/scans`: one page of an asset's or kit's scan history.
 *
 * Pins the permission gate, the workspace scoping of every read, the
 * parameter rules, the cursor paging, and the payload shape the scan history
 * sheet consumes.
 *
 * @see {@link file://./../../../app/routes/api+/scans.ts}
 */
import { createScanWithRelations } from "@factories";
import { ShelfError } from "~/utils/error";

const { mockFindMany } = vi.hoisted(() => ({ mockFindMany: vi.fn() }));
// why: the database is the external boundary; the query it receives is what
// these tests assert.
vi.mock("~/database/db.server", () => ({
  db: { $connect: vi.fn(), scan: { findMany: mockFindMany } },
}));

const { mockRequirePermission } = vi.hoisted(() => ({
  mockRequirePermission: vi.fn(),
}));
// why: the RBAC gate has its own tests; here it either passes with the
// caller's workspace or refuses.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));
// why: Logger.error is the hand-off to Sentry. Whether a refusal is captured
// is decided downstream by the beforeSend hook, which reads the
// `shouldBeCaptured` flag on the error passed here. The test reads that flag
// at the hand-off instead of standing up Sentry.
vi.mock("~/utils/logger", () => ({
  Logger: {
    error: mockLoggerError,
    handledClientError: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    dev: vi.fn(),
  },
}));

import { toScanHistoryRow } from "~/modules/scan/history.server";
import { loader } from "~/routes/api+/scans";

/** Runs the loader for a query string. */
async function get(query: string) {
  const result = (await loader({
    request: new Request(`http://localhost/api/scans?${query}`),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as Parameters<typeof loader>[0])) as {
    data: Record<string, unknown>;
    init: ResponseInit | null;
  };
  return { status: result.init?.status ?? 200, body: result.data };
}

/** `count` scans, newest first, with ids scan-0, scan-1, ... */
function scans(count: number) {
  return Array.from({ length: count }, (_, index) =>
    createScanWithRelations({ id: `scan-${index}` })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({ organizationId: "org-1" });
  mockFindMany.mockResolvedValue([]);
});

describe("GET /api/scans", () => {
  it("refuses a caller without scan:read", async () => {
    mockRequirePermission.mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 403,
        message: "You have no permission to perform this action",
        label: "Permission",
      })
    );

    const { status } = await get("assetId=asset-1");

    expect(status).toBe(403);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("reads only the caller's workspace, for the asset asked about, at most 26 rows", async () => {
    await get("assetId=asset-1");

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-1", organizationId: "org-1" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 26,
      })
    );
    expect(mockFindMany.mock.calls[0][0]).not.toHaveProperty("cursor");
  });

  it("reads a kit's scans by the kit", async () => {
    await get("kitId=kit-1");

    expect(mockFindMany.mock.calls[0][0].where).toEqual({
      kitId: "kit-1",
      organizationId: "org-1",
    });
  });

  it.each([
    ["neither an asset nor a kit", ""],
    ["both an asset and a kit", "assetId=asset-1&kitId=kit-1"],
    ["an empty cursor", "assetId=asset-1&cursor="],
  ])("refuses %s as a 400 that is not captured", async (_case, query) => {
    const { status } = await get(query);

    expect(status).toBe(400);
    expect(mockFindMany).not.toHaveBeenCalled();
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError.mock.calls[0][0]).toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      message: "Invalid scan history query: ask for one asset or one kit.",
    });
  });

  it("returns 25 rows and the cursor to the next page when there are more", async () => {
    const rows = scans(26);
    mockFindMany.mockResolvedValue(rows);

    const { status, body } = await get("assetId=asset-1");

    expect(status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.scans).toEqual(rows.slice(0, 25).map(toScanHistoryRow));
    expect(body.nextCursor).toBe("scan-24");
  });

  it("returns no cursor on the last page", async () => {
    mockFindMany.mockResolvedValue(scans(3));

    const { body } = await get("assetId=asset-1");

    expect(body.scans).toHaveLength(3);
    expect(body.nextCursor).toBeNull();
  });

  it("continues after the cursor it is given", async () => {
    await get("assetId=asset-1&cursor=scan-24");

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: { id: "scan-24" }, skip: 1 })
    );
  });
});
