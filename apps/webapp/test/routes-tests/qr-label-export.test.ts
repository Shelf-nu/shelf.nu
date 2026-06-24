// @vitest-environment node
/**
 * Bulk QR Export loader — behavioral wiring tests.
 *
 * The db mock honors org-scoping + id filtering, so IDOR and the lifted cap are
 * verified by OUTPUT (foreign asset absent / 150 returned), not by inspecting
 * the where-clause. Resolver text and the branding tier-gate run the real pure
 * functions; only db/auth/tier/env are mocked.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ALL_SELECTED = "all-selected";

/** Mutable per-test config the mocks read. */
const CONFIG: {
  org: {
    qrIdDisplayPreference: string;
    barcodesEnabled: boolean;
    showShelfBranding: boolean;
  };
  canHide: boolean;
} = {
  org: {
    qrIdDisplayPreference: "QR_ID",
    barcodesEnabled: false,
    showShelfBranding: true,
  },
  canHide: true,
};

/** In-memory asset store the db mock filters. */
let STORE: any[] = [];

const dataMock = vi.hoisted(() => ({
  fn: (value: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(value), {
      status: init?.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
}));

vi.mock("react-router", async () => {
  const actual = await vi.importActual<any>("react-router");
  return { ...actual, data: dataMock.fn };
});

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(async ({ where }: any) =>
        STORE.filter((a) => {
          if (where.organizationId && a.organizationId !== where.organizationId)
            return false;
          if (where.id?.in && !where.id.in.includes(a.id)) return false;
          return true;
        })
      ),
    },
  },
}));

vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: vi.fn(),
}));
vi.mock("~/modules/qr/utils.server", () => ({
  getQrBaseUrl: () => "https://eam.sh",
}));
vi.mock("~/modules/asset/utils.server", () => ({
  // select-all path: just scope to the org (the real filter logic isn't under test here).
  getAssetsWhereInput: vi.fn(({ organizationId }: any) => ({ organizationId })),
}));
vi.mock("~/utils/subscription.server", () => ({
  canHideShelfBranding: vi.fn(),
  assertUserCanExportAssets: vi.fn(),
}));
vi.mock("~/utils/logger", () => ({
  // handledClientError is invoked by http.server's error() path; stub it too so
  // the 4xx/error branches don't blow up on a missing Logger method.
  Logger: { warn: vi.fn(), error: vi.fn(), handledClientError: vi.fn() },
}));

const { loader, MAX_BULK_QR_EXPORT } = await import(
  "~/routes/api+/assets.get-assets-for-bulk-qr-download"
);
const { db } = await import("~/database/db.server");
const { getAssetsWhereInput } = await import("~/modules/asset/utils.server");
const { requirePermission } = await import("~/utils/roles.server");
const { getOrganizationTierLimit } = await import(
  "~/modules/tier/service.server"
);
const { canHideShelfBranding, assertUserCanExportAssets } = await import(
  "~/utils/subscription.server"
);

function makeAsset(over: Partial<any> = {}) {
  return {
    id: "a1",
    title: "MacBook Pro 16",
    organizationId: "org-1",
    sequentialId: "SAM-0001",
    preferredBarcodeId: null,
    qrCodes: [{ id: "qr-a1" }],
    barcodes: [],
    ...over,
  };
}

async function callLoader(assetIds: string[]) {
  const params = assetIds
    .map((id) => `assetIds=${encodeURIComponent(id)}`)
    .join("&");
  const args: any = {
    context: { getSession: () => ({ userId: "user-1" }) },
    request: new Request(
      `https://x/api/assets/get-assets-for-bulk-qr-download?${params}`
    ),
    params: {},
  };
  const res = (await loader(args)) as unknown as Response;
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  STORE = [makeAsset()];
  CONFIG.org = {
    qrIdDisplayPreference: "QR_ID",
    barcodesEnabled: false,
    showShelfBranding: true,
  };
  CONFIG.canHide = true;
  vi.mocked(requirePermission).mockImplementation(
    async () =>
      ({
        organizationId: "org-1",
        organizations: [
          {
            id: "org-1",
            type: "TEAM",
            name: "Org",
            imageId: null,
            userId: "user-1",
          },
        ],
        currentOrganization: CONFIG.org,
      }) as any
  );
  vi.mocked(getOrganizationTierLimit).mockResolvedValue({
    canHideShelfBranding: true,
  } as any);
  vi.mocked(canHideShelfBranding).mockImplementation(() => CONFIG.canHide);
  vi.mocked(assertUserCanExportAssets).mockResolvedValue(undefined);
});

describe("paid-feature gate", () => {
  it("blocks free users — assertUserCanExportAssets throws → non-200, no assets", async () => {
    vi.mocked(assertUserCanExportAssets).mockRejectedValue(
      Object.assign(new Error("Upgrade required"), { status: 403 })
    );
    const { status, body } = await callLoader(["a1"]);
    expect(status).not.toBe(200);
    expect(body.assets).toBeUndefined();
  });
});

describe("resolver-driven idText (A4–A8)", () => {
  it("A5 — QR_ID preference prints the QR id", async () => {
    CONFIG.org.qrIdDisplayPreference = "QR_ID";
    const { body } = await callLoader(["a1"]);
    expect(body.assets[0].idText).toBe("qr-a1");
  });

  it("A4 — SAM_ID preference prints the sequentialId", async () => {
    CONFIG.org.qrIdDisplayPreference = "SAM_ID";
    STORE = [makeAsset({ sequentialId: "SAM-0007" })];
    const { body } = await callLoader(["a1"]);
    expect(body.assets[0].idText).toBe("SAM-0007");
  });

  it("A6 — barcode preference prints the barcode value when the add-on is on", async () => {
    CONFIG.org = {
      qrIdDisplayPreference: "Code128",
      barcodesEnabled: true,
      showShelfBranding: true,
    };
    STORE = [
      makeAsset({
        barcodes: [{ id: "b1", type: "Code128", value: "WH-ABC-001" }],
      }),
    ];
    const { body } = await callLoader(["a1"]);
    expect(body.assets[0].idText).toBe("WH-ABC-001");
  });

  it("A7 (security) — barcode value does NOT leak when the add-on is off", async () => {
    CONFIG.org = {
      qrIdDisplayPreference: "Code128",
      barcodesEnabled: false,
      showShelfBranding: true,
    };
    STORE = [
      makeAsset({
        barcodes: [{ id: "b1", type: "Code128", value: "WH-ABC-001" }],
      }),
    ];
    const { body } = await callLoader(["a1"]);
    expect(body.assets[0].idText).toBe("qr-a1");
    expect(JSON.stringify(body)).not.toContain("WH-ABC-001");
  });

  it("A8 — per-asset preferredBarcode overrides the workspace preference", async () => {
    CONFIG.org = {
      qrIdDisplayPreference: "QR_ID",
      barcodesEnabled: true,
      showShelfBranding: true,
    };
    STORE = [
      makeAsset({
        preferredBarcodeId: "b2",
        barcodes: [{ id: "b2", type: "Code39", value: "PREF-9" }],
      }),
    ];
    const { body } = await callLoader(["a1"]);
    expect(body.assets[0].idText).toBe("PREF-9");
  });
});

describe("branding tier-gate (A9–A11, security)", () => {
  it("A9 — branding shown when the org wants it", async () => {
    CONFIG.canHide = true;
    CONFIG.org.showShelfBranding = true;
    const { body } = await callLoader(["a1"]);
    expect(body.showBranding).toBe(true);
  });

  it("A10 — branding hidden when allowed and the org opts out", async () => {
    CONFIG.canHide = true;
    CONFIG.org.showShelfBranding = false;
    const { body } = await callLoader(["a1"]);
    expect(body.showBranding).toBe(false);
  });

  it("A11 (bypass) — a free tier CANNOT strip branding via export", async () => {
    CONFIG.canHide = false;
    CONFIG.org.showShelfBranding = false;
    const { body } = await callLoader(["a1"]);
    expect(body.showBranding).toBe(true);
  });
});

describe("loader wiring (A15–A19, A24)", () => {
  it("A15 — 150 assets export with no cap error", async () => {
    STORE = Array.from({ length: 150 }, (_, i) =>
      makeAsset({ id: `a${i}`, qrCodes: [{ id: `qr-${i}` }] })
    );
    const { status, body } = await callLoader([ALL_SELECTED]);
    expect(status).toBe(200);
    expect(body.assets).toHaveLength(150);
  });

  it("A16 (IDOR) — a foreign-org asset is absent from the output", async () => {
    STORE = [
      makeAsset({ id: "a1" }),
      makeAsset({ id: "foreign", organizationId: "org-2" }),
    ];
    const { body } = await callLoader(["a1", "foreign"]);
    const ids = body.assets.map((a: any) => a.id);
    expect(ids).toEqual(["a1"]);
    expect(ids).not.toContain("foreign");
  });

  it("forwards the active filters to getAssetsWhereInput on select-all", async () => {
    await callLoader([ALL_SELECTED, "s=laptop"].slice(0, 1)); // assetIds=all-selected
    expect(getAssetsWhereInput).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        currentSearchParams: expect.stringContaining("assetIds=all-selected"),
      })
    );
  });

  it("bounds the query with take so a huge select-all isn't fully loaded", async () => {
    await callLoader([ALL_SELECTED]);
    expect(db.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: MAX_BULK_QR_EXPORT + 1 })
    );
  });

  it("A18 — returns the env-derived qrBaseUrl", async () => {
    const { body } = await callLoader(["a1"]);
    expect(body.qrBaseUrl).toBe("https://eam.sh");
  });

  it("A19 — no raster src field on returned assets", async () => {
    const { body } = await callLoader(["a1"]);
    expect(body.assets[0]).not.toHaveProperty("src");
    expect(body.assets[0]).toEqual({
      id: "a1",
      title: "MacBook Pro 16",
      qrId: "qr-a1",
      idText: "qr-a1",
    });
  });

  it("A24 — an asset with no QR is skipped gracefully, not crashed", async () => {
    STORE = [makeAsset({ id: "a1" }), makeAsset({ id: "a2", qrCodes: [] })];
    const { status, body } = await callLoader(["a1", "a2"]);
    expect(status).toBe(200);
    expect(body.assets.map((a: any) => a.id)).toEqual(["a1"]);
  });

  it("returns 400 when no asset ids are provided", async () => {
    const { status } = await callLoader([]);
    expect(status).toBe(400);
  });
});
