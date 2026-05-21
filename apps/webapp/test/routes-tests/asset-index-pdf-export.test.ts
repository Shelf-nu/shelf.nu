/**
 * @vitest-environment node
 */
/**
 * Suite A — Asset-Index PDF Export (loader side).
 *
 * Tests pin the loader against the advanced-mode asset pipeline (post-F1
 * refactor on round-5 review). Mocks for permission/tier/settings/asset-
 * query/filters are set up as the loader needs them; assertions are
 * behavioral on the rendered HTML where possible (cell text, headers,
 * filter summary, exporter identity) and structural where the wiring
 * itself is the contract (e.g. A0.h calls getAssetIndexSettings with the
 * right args; A12 IDOR is org-scoped).
 *
 * Test IDs map 1:1 to PRD §6.1 rows; new IDs (A0.l/m/n/o) cover the F1/F2
 * findings from the round-5 review.
 *
 * @see PRD-asset-index-pdf-export.md §6.1
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — AdvancedIndexAsset shape (matches `app/modules/asset/types.ts`).
// Distinctive values picked so cell assertions can't collide with HTML
// chrome (Tailwind classes, label text, etc.).
// ───────────────────────────────────────────────────────────────────────────
const ORG_A_ASSET = {
  id: "asset-A-1",
  title: "AssetInOrgA",
  organizationId: "org-A",
  sequentialId: "SAM-DISTINCTIVE-0001",
  description: "DISTINCTIVE-DESC-LOREM",
  valuation: 1234,
  availableToBook: true,
  createdAt: new Date("2026-01-15T10:00:00Z"),
  updatedAt: new Date("2026-02-20T15:30:00Z"),
  status: "AVAILABLE",
  mainImage: "https://example.test/a.webp",
  thumbnailImage: "https://example.test/a-thumb.webp",
  qrId: "DISTINCTIVE-QR-ABCDEF",
  category: { id: "cat-1", name: "DISTINCTIVE-CAT-XYZ", color: "#fff" },
  location: { id: "loc-1", name: "DISTINCTIVE-LOC-WAREHOUSE" },
  kit: { id: "kit-1", name: "DISTINCTIVE-KIT-ALPHA" },
  tags: [
    { id: "tag-1", name: "DISTINCTIVE-TAG-DRILL", color: "#000" },
    { id: "tag-2", name: "DISTINCTIVE-TAG-POWER", color: "#000" },
  ],
  custody: {
    custodian: { name: "DISTINCTIVE-CUSTODIAN-JANE", user: null },
  },
  customFields: [
    {
      id: "cfv-1",
      value: { raw: "DISTINCTIVE-CF-SERIAL-VALUE" },
      customField: {
        id: "cf-1",
        name: "Serial",
        helpText: null,
        required: false,
        type: "TEXT",
        options: [],
      },
    },
    {
      id: "cfv-2",
      value: { raw: 9999, valueBoolean: null },
      customField: {
        id: "cf-2",
        name: "Cost",
        helpText: null,
        required: false,
        type: "AMOUNT",
        options: [],
      },
    },
  ],
  barcodes: [
    { id: "bc-1", type: "Code128", value: "DISTINCTIVE-BC-CODE128-001" },
    { id: "bc-2", type: "Code39", value: "DISTINCTIVE-BC-CODE39-002" },
  ],
  upcomingReminder: undefined,
  bookings: undefined,
};

const ORG_B_ASSET = {
  id: "asset-B-9",
  title: "AssetInOrgB",
  organizationId: "org-B",
  sequentialId: null,
  description: null,
  valuation: null,
  availableToBook: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  status: "AVAILABLE",
  mainImage: null,
  thumbnailImage: null,
  qrId: "qr-org-b",
  category: null,
  location: null,
  kit: null,
  tags: [],
  custody: null,
  customFields: [],
  barcodes: [],
  upcomingReminder: undefined,
  bookings: undefined,
};

// User's AssetIndexSettings.columns fixture. Mirrors the REAL persisted
// JSON shape: `{name, visible, position}` only — NO `label` field. C1
// fix (Codex P1 on commit 3d7ba0589): the loader must derive labels via
// `parseColumnName`. Default mix exercises a visible scalar, a visible
// scalar in a different position, and a hidden column.
const USER_COLUMN_FIXTURE = [
  { name: "name", visible: true, position: 1 },
  { name: "valuation", visible: true, position: 0 },
  { name: "status", visible: false, position: 2 },
];

// ───────────────────────────────────────────────────────────────────────────
// Mocks — module-scoped so per-test overrides + assertions are possible.
// ───────────────────────────────────────────────────────────────────────────

// D1: canonical settings loader. Defaults to USER_COLUMN_FIXTURE.
const getAssetIndexSettingsMock = vi.fn(async (..._args: unknown[]) => ({
  id: "settings-A",
  userId: "user-1",
  organizationId: "org-A",
  columns: USER_COLUMN_FIXTURE,
  freezeColumn: true,
  showAssetImage: true,
  mode: "SIMPLE",
}));

// D2: real exporter identity for footer.
type UserNameRow = {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
} | null;
const userFindUniqueMock = vi.fn(
  async (..._args: unknown[]): Promise<UserNameRow> => ({
    displayName: null,
    firstName: "DISTINCTIVE-FIRST",
    lastName: "DISTINCTIVE-LAST",
  })
);

// F1: advanced-mode asset pipeline. Returns `{assets}`; mock org-scopes
// the returned rows based on the input organizationId so A12 IDOR
// assertions hold (org-A request gets org-A asset, org-B asset is
// invisible to org-A regardless of any spoofed input).
const getAdvancedPaginatedAndFilterableAssetsMock = vi.fn(
  async (args: { organizationId?: string } = {}) => {
    const org = args.organizationId;
    if (org === "org-A") return { assets: [ORG_A_ASSET] };
    if (org === "org-B") return { assets: [ORG_B_ASSET] };
    return { assets: [] };
  }
);

// Filter-resolution helper used by both the URL and cookie paths.
const getAdvancedFiltersFromRequestMock = vi.fn(
  async (..._args: unknown[]) => ({
    filters: "",
    serializedCookie: undefined,
    redirectNeeded: false,
  })
);

vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findUnique: (...args: unknown[]) => userFindUniqueMock(...args),
    },
  },
}));

vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: (...args: unknown[]) =>
    getAssetIndexSettingsMock(...args),
}));

vi.mock("~/modules/asset/service.server", () => ({
  getAdvancedPaginatedAndFilterableAssets: (...args: unknown[]) =>
    (
      getAdvancedPaginatedAndFilterableAssetsMock as unknown as (
        ...a: unknown[]
      ) => unknown
    )(...args),
}));

vi.mock("~/utils/cookies.server", () => ({
  getAdvancedFiltersFromRequest: (...args: unknown[]) =>
    getAdvancedFiltersFromRequestMock(...args),
}));

// requirePermission seam — pins organizationId / role / currentOrganization.
// Variadic typed signature satisfies the wrapper's TS2556 contract.
const requirePermissionMock = vi.fn((..._args: unknown[]) => ({}) as unknown);
vi.mock("~/utils/roles.server", () => ({
  PermissionAction: { read: "read", export: "export" } as const,
  PermissionEntity: { asset: "asset" } as const,
  requirePermission: (...args: unknown[]) => requirePermissionMock(...args),
}));

// Tier read seam — verified real helper at
// `app/modules/tier/service.server.ts:107`. Drives A0.a / paid checks.
const getOrganizationTierLimitMock = vi.fn(
  (..._args: unknown[]) => ({}) as unknown
);
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: (...args: unknown[]) =>
    getOrganizationTierLimitMock(...args),
}));

const sanitizeFilenameMock = vi.fn((s: string) => s.replace(/[^\w.-]+/g, "_"));
vi.mock("~/utils/sanitize-filename", () => ({
  sanitizeFilename: (...args: unknown[]) =>
    sanitizeFilenameMock(...(args as [string])),
}));

const WORKSPACE_NAME = "Workspace-A";

import { loader } from "~/routes/_layout+/assets.export.$fileName[.pdf]";

function reqFor(url: string): {
  request: Request;
  params: { fileName: string };
  context: { getSession: () => { userId: string } };
} {
  return {
    request: new Request(url),
    params: { fileName: "asset-export.pdf" },
    context: { getSession: () => ({ userId: "user-1" }) },
  };
}

describe("Suite A — Asset-Index PDF Export (loader)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requirePermissionMock.mockResolvedValue({
      organizationId: "org-A",
      organizations: [{ id: "org-A", userId: "owner-A", name: WORKSPACE_NAME }],
      userOrganizations: [{ organizationId: "org-A" }],
      currentOrganization: {
        id: "org-A",
        userId: "owner-A",
        name: WORKSPACE_NAME,
        currency: "USD",
      },
      role: "ADMIN",
    });
    sanitizeFilenameMock.mockImplementation((s: string) =>
      s.replace(/[^\w.-]+/g, "_")
    );
    getAssetIndexSettingsMock.mockImplementation(async () => ({
      id: "settings-A",
      userId: "user-1",
      organizationId: "org-A",
      columns: USER_COLUMN_FIXTURE,
      freezeColumn: true,
      showAssetImage: true,
      mode: "SIMPLE",
    }));
    userFindUniqueMock.mockImplementation(async () => ({
      displayName: null,
      firstName: "DISTINCTIVE-FIRST",
      lastName: "DISTINCTIVE-LAST",
    }));
    getAdvancedFiltersFromRequestMock.mockImplementation(async () => ({
      filters: "",
      serializedCookie: undefined,
      redirectNeeded: false,
    }));
  });

  describe("A0 — loader wiring (permission + tier + filter pipeline)", () => {
    it("A0.a free-tier (canExportAssets=false) → throws 403/ShelfError", async () => {
      console.log("[A0.a] free tier rejected");
      getOrganizationTierLimitMock.mockResolvedValue({
        canExportAssets: false,
      });
      await expect(
        loader(reqFor("https://shelf.test/assets/export/x.pdf") as never)
      ).rejects.toThrow();
    });

    it("A0.b paid-tier renders HTML containing workspace name", async () => {
      console.log("[A0.b] paid tier renders");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      expect(res).toBeInstanceOf(Response);
      const html = await (res as Response).text();
      expect(html).toContain(WORKSPACE_NAME);
    });

    it("A0.c filter round-trip: getAdvancedFiltersFromRequest resolves URL params and forwards them into the asset pipeline", async () => {
      console.log("[A0.c] filter round-trip via advanced pipeline");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      getAdvancedFiltersFromRequestMock.mockResolvedValueOnce({
        filters: "location=W1&tag=drill",
        serializedCookie: undefined,
        redirectNeeded: false,
      });
      await loader(
        reqFor(
          "https://shelf.test/assets/export/x.pdf?location=W1&tag=drill"
        ) as never
      );
      // The filter-resolution helper was consulted with the request + org.
      expect(getAdvancedFiltersFromRequestMock).toHaveBeenCalled();
      // The resolved filters were forwarded into the asset pipeline.
      expect(getAdvancedPaginatedAndFilterableAssetsMock).toHaveBeenCalled();
      const pipelineArgs = getAdvancedPaginatedAndFilterableAssetsMock.mock
        .calls[0]?.[0] as {
        organizationId: string;
        filters?: string;
        takeAll?: boolean;
      };
      expect(pipelineArgs.organizationId).toBe("org-A");
      expect(pipelineArgs.filters).toBe("location=W1&tag=drill");
      expect(pipelineArgs.takeAll).toBe(true);
    });
  });

  describe("A10 — permission gate enforced at loader (never UI-only)", () => {
    it("A10 hitting the loader without the export permission throws regardless of UI state", async () => {
      console.log("[A10] permission gate at loader");
      requirePermissionMock.mockRejectedValueOnce(new Error("forbidden"));
      await expect(
        loader(reqFor("https://shelf.test/assets/export/x.pdf") as never)
      ).rejects.toThrow(/forbidden/i);
      expect(requirePermissionMock).toHaveBeenCalledWith(
        expect.objectContaining({ entity: "asset", action: "export" })
      );
    });
  });

  describe("A11 — no server PDF library imported", () => {
    it("A11 new feature files do not import @react-pdf/renderer, pdfkit, jspdf, or puppeteer", () => {
      console.log("[A11] no server PDF dep");
      const here = fileURLToPath(new URL(".", import.meta.url));
      const repoRoot = resolve(here, "../../../..");
      const files = [
        "apps/webapp/app/components/assets/assets-index/export-assets-pdf.tsx",
        "apps/webapp/app/routes/_layout+/assets.export.$fileName[.pdf].tsx",
      ];
      for (const f of files) {
        const src = readFileSync(resolve(repoRoot, f), "utf8");
        // CR-D fix on commit a93118d60: narrow the @react-pdf/renderer
        // regex to actual import syntax so a documentation-only mention
        // doesn't false-positive the test.
        //
        // CR-E fix on commit ba15ce0bb: CR-D missed the bare side-effect
        // import form `import '@react-pdf/renderer';` (no `from`, no
        // parens). Added a dedicated regex for that shape so the guard
        // can't be bypassed by a side-effect-only registration.
        const forbidden = [
          /import\s+['"]@react-pdf\/renderer['"]/,
          /(?:from\s+|import\s*\(|require\s*\()\s*['"]@react-pdf\/renderer['"]/,
          /from\s+['"]pdfkit['"]/,
          /from\s+['"]jspdf['"]/,
          /from\s+['"]puppeteer['"]/,
        ];
        for (const re of forbidden) {
          expect(src, `file ${f} matched forbidden pattern ${re}`).not.toMatch(
            re
          );
        }
      }
    });
  });

  describe("A12 — cross-org IDOR negative test (BEHAVIORAL)", () => {
    it("A12 foreign-org asset id never appears in the response HTML", async () => {
      console.log("[A12] cross-org IDOR behaviorally excluded");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      // Attacker is in org-A but supplies org-B's asset id via search params.
      const url = `https://shelf.test/assets/export/x.pdf?assetIds=${ORG_B_ASSET.id}`;
      const res = await loader(reqFor(url) as never);
      expect(res).toBeInstanceOf(Response);
      const html = await (res as Response).text();
      // BEHAVIORAL: org-B's asset id MUST NOT appear in the body.
      expect(html).not.toContain(ORG_B_ASSET.id);
      expect(html).not.toContain(ORG_B_ASSET.title);
      // AND org-A's own asset SHOULD appear (proves the loader actually
      // rendered something, not just returned empty).
      expect(html).toContain(ORG_A_ASSET.id);
      // STRUCTURAL backstop: the asset pipeline was called with the
      // caller's organizationId, never anything from request input.
      const pipelineArgs = getAdvancedPaginatedAndFilterableAssetsMock.mock
        .calls[0]?.[0] as {
        organizationId: string;
      };
      expect(pipelineArgs.organizationId).toBe("org-A");
    });
  });

  describe("A0.d — loader reads AssetIndexSettings.columns (user's columns honored)", () => {
    it("A0.d.1 visible user columns appear in the HTML, in position order; hidden ones absent", async () => {
      console.log("[A0.d.1] AssetIndexSettings columns honored");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // C1: labels derived via parseColumnName → name="Name", valuation="Value".
      expect(html).toContain("Value");
      expect(html).toContain("Name");
      // Position order: valuation (position 0) before name (position 1).
      const valBodyIdx = html.indexOf("1234"); // ORG_A_ASSET.valuation
      const nameBodyIdx = html.indexOf("AssetInOrgA"); // ORG_A_ASSET.title
      expect(valBodyIdx).toBeGreaterThan(-1);
      expect(nameBodyIdx).toBeGreaterThan(-1);
      expect(valBodyIdx).toBeLessThan(nameBodyIdx);
    });

    it("A0.d.2 (C1 regression) saved column entries with NO label field still render headers", async () => {
      console.log("[A0.d.2] C1 — derived labels render for label-less entries");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      expect(html).not.toContain("undefined");
    });

    it("A0.d.3 (C2 regression) row values populate for columns beyond id/title/status", async () => {
      console.log("[A0.d.3] C2 — full row-value coverage");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      getAssetIndexSettingsMock.mockResolvedValueOnce({
        id: "settings-A",
        userId: "user-1",
        organizationId: "org-A",
        columns: [
          { name: "sequentialId", visible: true, position: 0 },
          { name: "description", visible: true, position: 1 },
          { name: "valuation", visible: true, position: 2 },
          { name: "availableToBook", visible: true, position: 3 },
          { name: "kit", visible: true, position: 4 },
          { name: "tags", visible: true, position: 5 },
          { name: "custody", visible: true, position: 6 },
          { name: "qrId", visible: true, position: 7 },
        ],
        freezeColumn: true,
        showAssetImage: true,
        mode: "SIMPLE",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      expect(html).toContain("SAM-DISTINCTIVE-0001");
      expect(html).toContain("DISTINCTIVE-DESC-LOREM");
      expect(html).toContain("1234");
      expect(html).toContain("Yes");
      expect(html).toContain("DISTINCTIVE-KIT-ALPHA");
      expect(html).toContain("DISTINCTIVE-TAG-DRILL");
      expect(html).toContain("DISTINCTIVE-TAG-POWER");
      expect(html).toContain("DISTINCTIVE-CUSTODIAN-JANE");
      expect(html).toContain("DISTINCTIVE-QR-ABCDEF");
    });
  });

  describe("A0.g — (C3 regression) HTML-escape workspace name in <title>", () => {
    it("A0.g.1 workspace name with HTML injection payload is escaped, not interpolated raw", async () => {
      console.log("[A0.g.1] C3 — workspace name escaped in <title>");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const xssPayload = `Evil</title><script>alert('xss')</script>`;
      requirePermissionMock.mockResolvedValueOnce({
        organizationId: "org-A",
        organizations: [{ id: "org-A", userId: "owner-A", name: xssPayload }],
        userOrganizations: [{ organizationId: "org-A" }],
        currentOrganization: {
          id: "org-A",
          userId: "owner-A",
          name: xssPayload,
          currency: "USD",
        },
        role: "ADMIN",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
      expect(titleMatch).not.toBeNull();
      const titleInner = titleMatch![1];
      expect(titleInner).not.toContain("<script>");
      expect(titleInner).toContain("&lt;script&gt;");
      expect(titleInner).toContain("&lt;/title&gt;");
    });
  });

  describe("A0.e — filterSummary surfaces in the rendered HTML", () => {
    it("A0.e.1 filter param values from the request appear in the rendered HTML", async () => {
      console.log("[A0.e.1] filter summary surfaces");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor(
          "https://shelf.test/assets/export/x.pdf?location=DISTINCTIVE-LOC-XYZ&tag=DISTINCTIVE-TAG-ABC"
        ) as never
      );
      const html = await (res as Response).text();
      expect(html).toContain("DISTINCTIVE-LOC-XYZ");
      expect(html).toContain("DISTINCTIVE-TAG-ABC");
    });
  });

  describe("A0.f — includeImages URL param round-trips to thumbnails", () => {
    it("A0.f.1 ?includeImages=true renders <img> elements", async () => {
      console.log("[A0.f.1] includeImages=true renders thumbnails");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor(
          "https://shelf.test/assets/export/x.pdf?includeImages=true"
        ) as never
      );
      const html = await (res as Response).text();
      expect(html).toMatch(/<img\b[^>]*src=/i);
    });

    it("A0.f.2 ?includeImages absent renders zero <img>", async () => {
      console.log("[A0.f.2] includeImages absent renders no thumbnails");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      expect(html).not.toMatch(/<img\b/i);
    });
  });

  describe("A0.h — (D1 regression) loader uses canonical getAssetIndexSettings service", () => {
    it("A0.h.1 calls getAssetIndexSettings({userId, organizationId, canUseBarcodes, role})", async () => {
      console.log("[A0.h.1] D1 — loader uses settings service");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      await loader(reqFor("https://shelf.test/assets/export/x.pdf") as never);
      expect(getAssetIndexSettingsMock).toHaveBeenCalled();
      const args = getAssetIndexSettingsMock.mock.calls[0]?.[0] as {
        userId: string;
        organizationId: string;
        canUseBarcodes?: boolean;
        role?: string;
      };
      expect(args.userId).toBe("user-1");
      expect(args.organizationId).toBe("org-A");
      expect(args.role).toBe("ADMIN");
      expect(args.canUseBarcodes).toBe(false);
    });

    it("A0.h.2 canUseBarcodes propagates when currentOrganization.barcodesEnabled=true", async () => {
      console.log("[A0.h.2] D1 — barcodesEnabled forwarded");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      requirePermissionMock.mockResolvedValueOnce({
        organizationId: "org-A",
        organizations: [
          { id: "org-A", userId: "owner-A", name: WORKSPACE_NAME },
        ],
        userOrganizations: [{ organizationId: "org-A" }],
        currentOrganization: {
          id: "org-A",
          userId: "owner-A",
          name: WORKSPACE_NAME,
          barcodesEnabled: true,
          currency: "USD",
        },
        role: "OWNER",
      });
      await loader(reqFor("https://shelf.test/assets/export/x.pdf") as never);
      const settingsArgs = getAssetIndexSettingsMock.mock.calls[0]?.[0] as {
        canUseBarcodes?: boolean;
        role?: string;
      };
      expect(settingsArgs.canUseBarcodes).toBe(true);
      expect(settingsArgs.role).toBe("OWNER");
      // And the same flag flows into the asset pipeline so barcode
      // columns are hydrated.
      const pipelineArgs = getAdvancedPaginatedAndFilterableAssetsMock.mock
        .calls[0]?.[0] as {
        canUseBarcodes?: boolean;
      };
      expect(pipelineArgs.canUseBarcodes).toBe(true);
    });
  });

  describe("A0.i — (D2 regression) generatedBy uses real exporter identity", () => {
    it("A0.i.1 PDF footer contains the authenticated user's display name (not 'User')", async () => {
      console.log("[A0.i.1] D2 — real exporter identity in footer");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      expect(html).toContain("DISTINCTIVE-FIRST DISTINCTIVE-LAST");
      expect(userFindUniqueMock).toHaveBeenCalled();
      const args = userFindUniqueMock.mock.calls[0]?.[0] as {
        where?: { id?: string };
      };
      expect(args?.where?.id).toBe("user-1");
    });

    it("A0.i.2 falls back to 'User' when the user record cannot be resolved", async () => {
      console.log("[A0.i.2] D2 — graceful fallback when user missing");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      userFindUniqueMock.mockResolvedValueOnce(null);
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      expect(html).toContain("User");
    });
  });

  describe("A0.l — (F1 regression) loader uses canonical advanced-mode asset pipeline", () => {
    it("A0.l.1 calls getAdvancedPaginatedAndFilterableAssets with takeAll=true and request/settings forwarded", async () => {
      // Codex F1 on commit 6dd022d07: the loader previously used a
      // simple-mode `db.asset.findMany` + `getAssetsWhereInput`, which
      // ignored ADVANCED-mode operators and custom-field filters and
      // couldn't hydrate `customFields` / `barcodes`. The advanced
      // pipeline (what CSV uses) is the canonical primitive.
      console.log("[A0.l.1] F1 — advanced pipeline + takeAll");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      await loader(reqFor("https://shelf.test/assets/export/x.pdf") as never);
      expect(getAdvancedPaginatedAndFilterableAssetsMock).toHaveBeenCalled();
      const args = getAdvancedPaginatedAndFilterableAssetsMock.mock
        .calls[0]?.[0] as {
        organizationId: string;
        takeAll?: boolean;
        settings?: unknown;
        request?: unknown;
      };
      expect(args.organizationId).toBe("org-A");
      expect(args.takeAll).toBe(true);
      // The same `settings` object loaded via getAssetIndexSettings is
      // forwarded — so the pipeline shares column config with the loader.
      expect(args.settings).toBeDefined();
      // The request is forwarded so the pipeline can resolve sort /
      // pagination params from URL.
      expect(args.request).toBeInstanceOf(Request);
    });
  });

  describe("A0.m — (F2 regression) custom-field columns render via real customField value", () => {
    it("A0.m.1 a visible cf_<name> column produces a cell containing the custom-field value", async () => {
      console.log("[A0.m.1] F2 — cf_* column renders");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      getAssetIndexSettingsMock.mockResolvedValueOnce({
        id: "settings-A",
        userId: "user-1",
        organizationId: "org-A",
        columns: [
          { name: "name", visible: true, position: 0 },
          {
            name: "cf_Serial",
            visible: true,
            position: 1,
            cfType: "TEXT",
          },
        ] as never, // Column[] shape (with cfType) — wider than the mock's inferred type.
        freezeColumn: true,
        showAssetImage: true,
        mode: "ADVANCED",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // ORG_A_ASSET.customFields[0] has value.raw="DISTINCTIVE-CF-SERIAL-VALUE"
      // with customField.name="Serial". The cf_Serial column must surface it.
      expect(html).toContain("DISTINCTIVE-CF-SERIAL-VALUE");
    });

    it("A0.m.2 cf_AMOUNT renders via currency formatter (uses currentOrganization.currency)", async () => {
      console.log("[A0.m.2] F2 — cf_AMOUNT formats as currency");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      getAssetIndexSettingsMock.mockResolvedValueOnce({
        id: "settings-A",
        userId: "user-1",
        organizationId: "org-A",
        columns: [
          {
            name: "cf_Cost",
            visible: true,
            position: 0,
            cfType: "AMOUNT",
          },
        ] as never, // Column[] shape (with cfType) — wider than the mock's inferred type.
        freezeColumn: true,
        showAssetImage: true,
        mode: "ADVANCED",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // ORG_A_ASSET.customFields[1].value.raw=9999, currency=USD →
      // formatted "$9,999.00".
      expect(html).toContain("$9,999.00");
    });
  });

  describe("A0.n — (F2 regression) barcode columns render via real barcode value", () => {
    it("A0.n.1 a visible barcode_<type> column produces a cell containing the barcode value", async () => {
      console.log("[A0.n.1] F2 — barcode_* column renders");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      getAssetIndexSettingsMock.mockResolvedValueOnce({
        id: "settings-A",
        userId: "user-1",
        organizationId: "org-A",
        columns: [
          { name: "barcode_Code128", visible: true, position: 0 },
          { name: "barcode_Code39", visible: true, position: 1 },
        ],
        freezeColumn: true,
        showAssetImage: true,
        mode: "ADVANCED",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      expect(html).toContain("DISTINCTIVE-BC-CODE128-001");
      expect(html).toContain("DISTINCTIVE-BC-CODE39-002");
    });
  });

  describe("A0.o — (E2 retained) UI-only `actions` column stays filtered out", () => {
    it("A0.o.1 settings include `actions` → does NOT render a header", async () => {
      // The PDF_RENDERABLE_COLUMN_NAMES allowlist was dropped with F2;
      // `actions` is the one column we still suppress, mirroring CSV.
      console.log("[A0.o.1] actions column excluded");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      getAssetIndexSettingsMock.mockResolvedValueOnce({
        id: "settings-A",
        userId: "user-1",
        organizationId: "org-A",
        columns: [
          { name: "name", visible: true, position: 0 },
          { name: "actions", visible: true, position: 1 },
        ],
        freezeColumn: true,
        showAssetImage: false,
        mode: "SIMPLE",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // why: `<th\b` (word boundary) prevents matching `<thead>`, which
      // would otherwise greedy-capture cross-cell content up to the first
      // `</th>` and conflate it with header text.
      const headers = Array.from(
        html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)
      ).map((m) => m[1].trim());
      expect(headers).not.toContain("Actions");
      expect(headers).toContain("Name");
    });
  });
});
