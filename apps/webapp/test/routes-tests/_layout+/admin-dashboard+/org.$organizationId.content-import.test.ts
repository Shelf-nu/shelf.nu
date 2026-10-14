/**
 * Admin organization route: the "Import content" form (`content` intent),
 * which imports a CSV of new assets into the workspace whose page is open.
 *
 * The admin is not a member of that workspace, so whether the file may carry
 * barcodes is that workspace's entitlement: its own `barcodesEnabled` setting,
 * or always allowed when premium features are off (self-hosted).
 *
 * @see {@link file://./../../../../app/routes/_layout+/admin-dashboard+/org.$organizationId.tsx}
 * @see {@link file://./../../../../app/modules/asset/service.server.ts} createAssetsFromContentImport
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/admin-dashboard+/org.$organizationId";

// why: the route's component tree imports lottie, which draws on a canvas at
// import time; happy-dom has no canvas.
vi.mock("lottie-react", () => ({
  __esModule: true,
  default: vi.fn(() => null),
}));

// why: the workspace's barcode setting is read through Prisma; each test sets it.
vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findUniqueOrThrow: vi.fn() },
  },
}));

// why: requireAdmin reads the caller's roles from the database.
vi.mock("~/utils/roles.server", () => ({
  requireAdmin: vi.fn(),
}));

// why: the uploaded file arrives as multipart form data, which happy-dom does
// not round-trip; the parsed rows are what the route works with.
vi.mock("~/utils/csv.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("~/utils/csv.server")),
  csvDataFromRequest: vi.fn(),
}));

// why: the entitlement helper reads the premium-features flag at module load;
// wrapping the real helper lets one case switch premium features off.
vi.mock("~/utils/subscription.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/utils/subscription.server")
  >("~/utils/subscription.server");
  return { ...actual, canUseBarcodes: vi.fn(actual.canUseBarcodes) };
});

// why: the import itself writes assets; these tests assert what it is asked to do.
vi.mock("~/modules/asset/service.server", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "~/modules/asset/service.server"
  )),
  createAssetsFromContentImport: vi.fn(),
}));

import { db } from "~/database/db.server";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { csvDataFromRequest } from "~/utils/csv.server";
import { requireAdmin } from "~/utils/roles.server";
import { canUseBarcodes } from "~/utils/subscription.server";

/** The admin driving the page. */
const ADMIN_ID = "admin-1";
/** The workspace whose page is open. */
const ORG_ID = "org-1";

/** Builds action args posting the "Import content" form. */
function contentImportArgs() {
  return {
    request: new Request(`http://localhost/admin-dashboard/org/${ORG_ID}`, {
      method: "POST",
      body: new URLSearchParams({ intent: "content" }),
    }),
    params: { organizationId: ORG_ID },
    context: { getSession: () => ({ userId: ADMIN_ID }) },
  } as unknown as Parameters<typeof action>[0];
}

/** Sets the open workspace's barcode setting. */
function givenBarcodesEnabled(barcodesEnabled: boolean) {
  vi.mocked(db.organization.findUniqueOrThrow).mockResolvedValue({
    barcodesEnabled,
  } as unknown as Awaited<
    ReturnType<typeof db.organization.findUniqueOrThrow>
  >);
}

describe("admin org route: content import", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ADMIN_ID } as never);
    vi.mocked(canUseBarcodes).mockImplementation((org) => org.barcodesEnabled);
    vi.mocked(csvDataFromRequest).mockResolvedValue([
      ["title", "barcode_Code128"],
      ["Camera 1", "CAM00001"],
    ]);
    vi.mocked(createAssetsFromContentImport).mockResolvedValue(true);
  });

  it("allows barcode columns when the workspace has barcodes enabled", async () => {
    givenBarcodesEnabled(true);

    await action(contentImportArgs());

    expect(db.organization.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: ORG_ID },
      select: { barcodesEnabled: true },
    });
    expect(createAssetsFromContentImport).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        userId: ADMIN_ID,
        canUseBarcodes: true,
      })
    );
  });

  it("passes the disabled barcode setting to the import", async () => {
    givenBarcodesEnabled(false);

    await action(contentImportArgs());

    expect(createAssetsFromContentImport).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        canUseBarcodes: false,
      })
    );
  });

  it("allows barcode columns on an install with premium features off", async () => {
    givenBarcodesEnabled(false);
    // Premium features off: every workspace may use barcodes.
    vi.mocked(canUseBarcodes).mockReturnValue(true);

    await action(contentImportArgs());

    expect(canUseBarcodes).toHaveBeenCalledWith({ barcodesEnabled: false });
    expect(createAssetsFromContentImport).toHaveBeenCalledWith(
      expect.objectContaining({ canUseBarcodes: true })
    );
  });
});
