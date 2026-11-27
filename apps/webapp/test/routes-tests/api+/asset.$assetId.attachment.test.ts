// @vitest-environment node
/**
 * `/api/asset/:assetId/attachment`: opening, staging and removing an asset's
 * PDF attachment.
 *
 * Opening (`GET`) re-checks permission and redirects to a URL signed for one
 * minute, for the caller's own asset or for a file staged under a create-form
 * placeholder id. Every method refuses an `assetId` that is not a plain id,
 * because it becomes a storage path segment.
 *
 * Only the database, Storage and the permission gate are mocked; the
 * attachment module runs for real.
 *
 * @see {@link file://./../../../app/routes/api+/asset.$assetId.attachment.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

const {
  mockAssetCount,
  mockAssetFindFirst,
  mockAssetFindMany,
  mockAssetUpdate,
  mockCreateSignedUrl,
  mockListFilesInFolder,
  mockParsePdfFormData,
  mockRequirePermission,
} = vi.hoisted(() => ({
  mockAssetCount: vi.fn(),
  mockAssetFindFirst: vi.fn(),
  mockAssetFindMany: vi.fn(),
  mockAssetUpdate: vi.fn(),
  mockCreateSignedUrl: vi.fn(),
  mockListFilesInFolder: vi.fn(),
  mockParsePdfFormData: vi.fn(),
  mockRequirePermission: vi.fn(),
}));

// why: the asset reads and writes are Prisma calls; no real database in
// tests. `count` and `findMany` answer the shared archived-asset guard.
vi.mock("~/database/db.server", () => ({
  db: {
    $connect: vi.fn(),
    asset: {
      count: mockAssetCount,
      findFirst: mockAssetFindFirst,
      findFirstOrThrow: mockAssetFindFirst,
      findMany: mockAssetFindMany,
      update: mockAssetUpdate,
    },
  },
}));

// why: Supabase Storage is an external service. The key each call receives is
// the object the route grants access to.
vi.mock("~/utils/storage.server", () => ({
  createSignedUrl: mockCreateSignedUrl,
  listFilesInFolder: mockListFilesInFolder,
  parsePdfFormData: mockParsePdfFormData,
  removeFileAtPath: vi.fn(),
  removeFilesAtPaths: vi.fn(),
}));

// why: the RBAC matrix is tested elsewhere; here the gate grants the caller's
// workspace, and each test decides whether `asset: update` is held.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: mockRequirePermission,
}));

import { action, loader } from "~/routes/api+/asset.$assetId.attachment";

const ORG = "org-A";
const ASSET_ID = "cmassetcamera0001";
const PLACEHOLDER = "5f0c6a2e-1111-4222-8333-444455556666";
const FILE_NAME =
  "attachment-1760000000-0b7f1a2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c.pdf";
const ASSET_PATH = `${ORG}/${ASSET_ID}/${FILE_NAME}`;
const SIGNED = "https://storage.example/sign/assets/file?token=t";

type LoaderArgs = Parameters<typeof loader>[0];
type ActionArgs = Parameters<typeof action>[0];

function args(assetId: string, method = "GET") {
  return {
    request: new Request(
      `https://app.shelf.nu/api/asset/${encodeURIComponent(
        assetId
      )}/attachment`,
      { method }
    ),
    params: { assetId },
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as LoaderArgs & ActionArgs;
}

/** The status of a `data(...)` result or a thrown `data(...)` response. */
function statusOf(result: unknown): number | undefined {
  if (result instanceof Response) return result.status;
  return (result as { init?: { status?: number } }).init?.status;
}

/** Grants `asset: read`, and `asset: update` only when `canUpdate`. */
function grant({ canUpdate }: { canUpdate: boolean }) {
  mockRequirePermission.mockImplementation(
    ({ action: permissionAction }: { action: string }) => {
      if (permissionAction === "update" && !canUpdate) {
        throw new ShelfError({
          cause: null,
          message: "You do not have permission",
          label: "Permission",
          status: 403,
        });
      }
      return Promise.resolve({ organizationId: ORG });
    }
  );
}

describe("GET /api/asset/:assetId/attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSignedUrl.mockResolvedValue(SIGNED);
    grant({ canUpdate: false });
  });

  it("redirects to the asset's own file, signed for one minute", async () => {
    mockAssetFindFirst.mockResolvedValue({ attachmentPath: ASSET_PATH });

    const response = await loader(args(ASSET_ID));

    expect(response).toBeInstanceOf(Response);
    expect(statusOf(response)).toBe(302);
    expect((response as Response).headers.get("Location")).toBe(SIGNED);
    expect(mockAssetFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ASSET_ID, organizationId: ORG },
      })
    );
    expect(mockCreateSignedUrl).toHaveBeenCalledWith({
      filename: ASSET_PATH,
      bucketName: "assets",
      expiresIn: 60,
    });
  });

  it("answers 404 for an asset with no attachment", async () => {
    mockAssetFindFirst.mockResolvedValue({ attachmentPath: null });

    const result = await loader(args(ASSET_ID));

    expect(statusOf(result)).toBe(404);
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });

  it("opens a staged file by placeholder id for a member who may stage", async () => {
    grant({ canUpdate: true });
    mockAssetFindFirst.mockResolvedValue(null);
    mockListFilesInFolder.mockResolvedValue([{ name: FILE_NAME, size: 10 }]);

    const response = await loader(args(PLACEHOLDER));

    expect(statusOf(response)).toBe(302);
    expect(mockListFilesInFolder).toHaveBeenCalledWith({
      folder: `${ORG}/${PLACEHOLDER}`,
      bucketName: "assets",
    });
    expect(mockCreateSignedUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: `${ORG}/${PLACEHOLDER}/${FILE_NAME}`,
      })
    );
  });

  it("refuses a staged file to a member who may only read assets", async () => {
    mockAssetFindFirst.mockResolvedValue(null);

    const result = await loader(args(PLACEHOLDER));

    expect(statusOf(result)).toBe(403);
    expect(mockListFilesInFolder).not.toHaveBeenCalled();
    expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  });
});

describe("assetId that is not a plain id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant({ canUpdate: true });
  });

  it.each([["../org-B/asset-b"], [".."], ["asset%2F.."]])(
    "refuses %j on every method before touching storage",
    async (assetId) => {
      for (const run of [
        () => loader(args(assetId)),
        () => action(args(assetId, "POST")),
        () => action(args(assetId, "DELETE")),
      ]) {
        const outcome = await run().catch((thrown: unknown) => thrown);
        expect(statusOf(outcome)).toBe(400);
      }

      expect(mockAssetFindFirst).not.toHaveBeenCalled();
      expect(mockParsePdfFormData).not.toHaveBeenCalled();
      expect(mockListFilesInFolder).not.toHaveBeenCalled();
      expect(mockCreateSignedUrl).not.toHaveBeenCalled();
    }
  );
});

describe("POST and DELETE on an archived asset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grant({ canUpdate: true });
    mockAssetFindFirst.mockResolvedValue({
      id: ASSET_ID,
      attachmentPath: ASSET_PATH,
    });
  });

  /** Makes the shared guard see `ASSET_ID` as archived, or not. */
  function archived(isArchived: boolean) {
    mockAssetCount.mockResolvedValue(isArchived ? 1 : 0);
    mockAssetFindMany.mockResolvedValue(
      isArchived ? [{ id: ASSET_ID, title: "Drill" }] : []
    );
  }

  it.each([["POST"], ["DELETE"]])(
    "refuses %s with the archived-asset message and changes nothing",
    async (method) => {
      archived(true);

      const result = await action(args(ASSET_ID, method));

      expect(statusOf(result)).toBe(400);
      expect(
        (result as { data?: { error?: { message?: string } } }).data?.error
          ?.message
      ).toMatch(/archived/i);
      expect(mockParsePdfFormData).not.toHaveBeenCalled();
      expect(mockAssetUpdate).not.toHaveBeenCalled();
    }
  );

  it("lets an active asset's attachment be replaced", async () => {
    archived(false);
    mockParsePdfFormData.mockResolvedValue({
      path: `${ORG}/${ASSET_ID}/${FILE_NAME}`,
      originalName: "invoice.pdf",
      size: 10,
    });
    mockAssetUpdate.mockResolvedValue({ id: ASSET_ID });

    const result = await action(args(ASSET_ID, "POST"));

    // payload() stamps `error: null` onto every success.
    expect((result as { data?: { error?: unknown } }).data?.error).toBeNull();
    expect(mockAssetUpdate).toHaveBeenCalledTimes(1);
    expect(mockAssetFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: ASSET_ID, organizationId: ORG, archivedAt: null },
      })
    );
  });
});
