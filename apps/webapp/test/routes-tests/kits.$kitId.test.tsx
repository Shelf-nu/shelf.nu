/**
 * Route action tests for `kits.$kitId.tsx` — focused on the `removeAsset`
 * intent. Verifies the discriminator-aware custody cleanup that:
 *
 * 1. Filters the per-asset Custody deletion by `kitCustodyId` so
 *    operator-assigned custody on the same asset is preserved.
 * 2. Only flips the asset's status back to AVAILABLE when zero custody
 *    rows remain — if operator custody is still present, the asset
 *    stays IN_CUSTODY.
 *
 * @see {@link file://./../../app/routes/_layout+/kits.$kitId.tsx}
 */

import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "~/routes/_layout+/kits.$kitId";
import { requirePermission } from "~/utils/roles.server";
import { getUserByID } from "~/modules/user/service.server";

const dbMocks = vi.hoisted(() => ({
  kit: { update: vi.fn() },
  asset: { update: vi.fn() },
  custody: { deleteMany: vi.fn(), count: vi.fn() },
}));

vi.mock("~/database/db.server", () => ({
  db: {
    kit: { update: dbMocks.kit.update },
    asset: { update: dbMocks.asset.update },
    custody: {
      deleteMany: dbMocks.custody.deleteMany,
      count: dbMocks.custody.count,
    },
    // why: the removeAsset case wraps kit disconnect + custody cleanup
    // + status flip in a single transaction; we route the inner calls
    // through to the same hoisted mocks.
    $transaction: vi.fn((cb: (tx: unknown) => unknown) =>
      cb({
        kit: { update: dbMocks.kit.update },
        asset: { update: dbMocks.asset.update },
        custody: {
          deleteMany: dbMocks.custody.deleteMany,
          count: dbMocks.custody.count,
        },
      })
    ),
  },
}));

vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

// why: createNote is fired after the transaction; we don't need to
// exercise note persistence in these unit tests.
vi.mock("~/modules/note/service.server", () => ({
  createNote: vi.fn().mockResolvedValue({}),
}));

// why: the kit detail route imports kit/service for unrelated intents;
// stub the imports we actually use.
vi.mock("~/modules/kit/service.server", () => ({
  deleteKit: vi.fn(),
  deleteKitImage: vi.fn(),
  getKit: vi.fn(),
  getKitCurrentBooking: vi.fn(),
  relinkKitQrCode: vi.fn(),
}));

// why: barcode service is imported but unused in removeAsset path.
vi.mock("~/modules/barcode/service.server", () => ({
  createBarcode: vi.fn(),
}));

vi.mock("~/modules/qr/utils.server", () => ({
  generateQrObj: vi.fn(),
}));

vi.mock("~/modules/scan/service.server", () => ({
  getScanByQrId: vi.fn(),
}));

vi.mock("~/modules/scan/utils.server", () => ({
  parseScanData: vi.fn(),
}));

vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: the route module imports UI components (CodePreview, ScanDetails)
// that transitively pull in lottie-web / Mapbox; those side-effecting
// modules crash on load under happy-dom. We only exercise the route's
// `action` export, so stubbing the components is safe.
vi.mock("~/components/code-preview/code-preview", () => ({
  CodePreview: () => null,
}));
vi.mock("~/components/location/scan-details", () => ({
  ScanDetails: () => null,
}));
vi.mock("~/components/kits/actions-dropdown", () => ({
  default: () => null,
}));
vi.mock("~/components/kits/booking-actions-dropdown", () => ({
  default: () => null,
}));
vi.mock("~/components/assets/asset-custody-card", () => ({
  CustodyCard: () => null,
}));

vi.mock("~/utils/http.server", () => ({
  assertIsPost: vi.fn(),
  parseData: vi.fn().mockImplementation((formData: FormData, schema: any) => {
    // Return whatever fields the schema expects, pulled from formData.
    const result: Record<string, unknown> = {};
    if (formData.get("intent")) result.intent = formData.get("intent");
    if (formData.get("assetId")) result.assetId = formData.get("assetId");
    if (formData.get("image")) result.image = formData.get("image");
    return result;
  }),
  getParams: vi.fn().mockImplementation((params: any) => ({
    kitId: params.kitId || "kit-123",
  })),
  payload: vi.fn((x) => ({ ...x })),
  error: vi.fn((x) => ({ error: x })),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  const mockResponse = (data: any, init?: { status?: number }) =>
    new Response(JSON.stringify(data), {
      status: init?.status || 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    ...actual,
    redirect: vi.fn(() => new Response(null, { status: 302 })),
    data: vi.fn(mockResponse),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const getUserByIDMock = vi.mocked(getUserByID);

function createActionArgs(
  request: Request,
  overrides: Partial<ActionFunctionArgs> = {}
): ActionFunctionArgs {
  return {
    context: {
      getSession: () => ({ userId: "user-123" }),
    },
    request,
    params: { kitId: "kit-123" },
    ...overrides,
  } as ActionFunctionArgs;
}

function buildRemoveAssetRequest(assetId: string): Request {
  const formData = new FormData();
  formData.set("intent", "removeAsset");
  formData.set("assetId", assetId);
  return new Request("https://example.com/kits/kit-123", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.kit.update.mockReset();
  dbMocks.asset.update.mockReset();
  dbMocks.custody.deleteMany.mockReset();
  dbMocks.custody.count.mockReset();
  requirePermissionMock.mockReset();

  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
  } as any);

  getUserByIDMock.mockResolvedValue({
    id: "user-123",
    firstName: "Test",
    lastName: "User",
  } as any);

  dbMocks.custody.deleteMany.mockResolvedValue({ count: 1 });
  dbMocks.asset.update.mockResolvedValue({});
});

describe("kits/$kitId removeAsset action", () => {
  it("removes only the kit-allocated Custody row when asset has operator-assigned custody too", async () => {
    // Kit is currently in custody (custody.id present), so the cleanup
    // path runs. Asset has both kit-allocated AND operator-assigned
    // custody → after deleteMany filtered by kitCustodyId, count > 0.
    dbMocks.kit.update.mockResolvedValue({
      name: "Mixed Custody Kit",
      custody: { id: "kc-1", custodianId: "tm-1" },
    });
    dbMocks.custody.count.mockResolvedValue(1); // Operator row remains.

    const request = buildRemoveAssetRequest("asset-mixed");
    const response = await action(createActionArgs(request));

    expect(response).toBeDefined();

    // Only the kit-allocated row was targeted.
    expect(dbMocks.custody.deleteMany).toHaveBeenCalledWith({
      where: { assetId: "asset-mixed", kitCustodyId: "kc-1" },
    });

    // Status flip path was NOT triggered — the asset still has custody
    // (operator-assigned), so it must stay IN_CUSTODY.
    expect(dbMocks.asset.update).not.toHaveBeenCalled();
  });

  it("flips asset status to AVAILABLE only when no custody rows remain", async () => {
    // Kit is in custody. Asset has ONLY kit-allocated custody, so after
    // the filtered deleteMany no rows remain → status should flip.
    dbMocks.kit.update.mockResolvedValue({
      name: "Sole Custody Kit",
      custody: { id: "kc-2", custodianId: "tm-1" },
    });
    dbMocks.custody.count.mockResolvedValue(0); // No remaining custody.

    const request = buildRemoveAssetRequest("asset-sole");
    await action(createActionArgs(request));

    expect(dbMocks.custody.deleteMany).toHaveBeenCalledWith({
      where: { assetId: "asset-sole", kitCustodyId: "kc-2" },
    });

    // Status flip happened.
    expect(dbMocks.asset.update).toHaveBeenCalledWith({
      where: { id: "asset-sole", organizationId: "org-1" },
      data: { status: "AVAILABLE" },
    });
  });

  it("skips custody cleanup entirely when kit has no active custody", async () => {
    // Kit is not in custody — the cleanup branch is bypassed.
    dbMocks.kit.update.mockResolvedValue({
      name: "Available Kit",
      custody: null,
    });

    const request = buildRemoveAssetRequest("asset-free");
    await action(createActionArgs(request));

    expect(dbMocks.custody.deleteMany).not.toHaveBeenCalled();
    expect(dbMocks.custody.count).not.toHaveBeenCalled();
    expect(dbMocks.asset.update).not.toHaveBeenCalled();
  });
});
