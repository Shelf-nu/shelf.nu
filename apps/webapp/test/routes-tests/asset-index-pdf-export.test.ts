/**
 * @vitest-environment node
 */
/**
 * Suite A — Asset-Index PDF Export (loader side).
 *
 * TDD RED STATE (commit 1): the loader is a throwing stub, so every test
 * below is red. Mocks for permission/tier/db are set up as the
 * implementation will need them, so a future green run requires the
 * loader to actually wire through these existing primitives.
 *
 * Test IDs map 1:1 to PRD-asset-index-pdf-export.md §6.1 rows.
 * Each test logs its ID (the /goal evaluator reads the transcript to
 * count passes).
 *
 * @see PRD-asset-index-pdf-export.md §6.1 (A0, A10, A11, A12)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// why: testing the loader's permission/tier/query wiring without
// executing actual database operations or HTTP plumbing.
// The asset.findMany mock RETURNS DIFFERENT ROWS based on the where
// clause's organizationId — this is what lets A12 assert behavioral
// IDOR exclusion (the foreign-org asset id never appears in output)
// instead of a structural-proxy "was the org id passed correctly".
// Distinctive scalar values picked so assertions can't collide with HTML
// chrome (Tailwind classes, label text, etc.). These also exercise the
// C2 row-value mapping for non-id/title columns.
const ORG_A_ASSET = {
  id: "asset-A-1",
  title: "AssetInOrgA",
  organizationId: "org-A",
  mainImage: "https://example.test/a.webp",
  thumbnailImage: "https://example.test/a-thumb.webp",
  sequentialId: "SAM-DISTINCTIVE-0001",
  description: "DISTINCTIVE-DESC-LOREM",
  valuation: 1234,
  availableToBook: true,
  createdAt: new Date("2026-01-15T10:00:00Z"),
  updatedAt: new Date("2026-02-20T15:30:00Z"),
  status: "AVAILABLE",
  category: { name: "DISTINCTIVE-CAT-XYZ" },
  location: { name: "DISTINCTIVE-LOC-WAREHOUSE" },
  kit: { name: "DISTINCTIVE-KIT-ALPHA" },
  tags: [{ name: "DISTINCTIVE-TAG-DRILL" }, { name: "DISTINCTIVE-TAG-POWER" }],
  qrCodes: [{ id: "DISTINCTIVE-QR-ABCDEF" }],
  custody: {
    custodian: {
      name: "DISTINCTIVE-CUSTODIAN-JANE",
      user: null,
    },
  },
};
const ORG_B_ASSET = {
  id: "asset-B-9",
  title: "AssetInOrgB",
  organizationId: "org-B",
  mainImage: null,
  thumbnailImage: null,
  sequentialId: null,
  description: null,
  valuation: null,
  availableToBook: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  status: "AVAILABLE",
  category: null,
  location: null,
  kit: null,
  tags: [],
  qrCodes: [],
  custody: null,
};

// User's AssetIndexSettings.columns fixture. Mirrors the REAL persisted
// JSON shape: `{name, visible, position}` only — NO `label` field. C1
// fix (Codex P1 on commit 3d7ba0589): the loader must derive labels via
// `parseColumnName` from `~/modules/asset-index-settings/helpers`. The
// expected derived labels (per `columnsLabelsMap`) are:
//   valuation → "Value"  |  name → "Name"  |  status → "Status"
const USER_COLUMN_FIXTURE = [
  { name: "name", visible: true, position: 1 },
  { name: "valuation", visible: true, position: 0 },
  { name: "status", visible: false, position: 2 },
];

// Module-scoped mocks so tests can override per-case via mockResolvedValueOnce.
const assetIndexSettingsMock = vi.fn(async (..._args: unknown[]) => ({
  id: "settings-A",
  userId: "user-1",
  organizationId: "org-A",
  columns: USER_COLUMN_FIXTURE,
  freezeColumn: true,
  showAssetImage: true,
}));

vi.mock("~/database/db.server", () => ({
  db: {
    asset: {
      findMany: vi.fn(
        async (
          args: { where?: { organizationId?: string; id?: unknown } } = {}
        ) => {
          // F1 GUARD (per CR §4.2 review): the PRD contract says the loader
          // must use getAssetsWhereInput EXCLUSIVELY and never add an id-
          // filter from request input. If a spec-violating impl adds
          // `where.id = { in: [...] }`, this mock returns nothing so the
          // positive A12 assertion (org-A asset DOES appear) fails — which
          // correctly BLOCKS /goal from green-lighting the violation.
          if (args.where?.id !== undefined) return [];
          const org = args.where?.organizationId;
          if (org === "org-A") return [ORG_A_ASSET];
          if (org === "org-B") return [ORG_B_ASSET];
          return [];
        }
      ),
    },
    organization: {
      findFirst: vi.fn(async () => ({
        id: "org-A",
        userId: "owner-A",
        name: "Workspace-A", // A0.b fixture: real workspace name in output
      })),
    },
    assetIndexSettings: {
      findFirst: (...args: unknown[]) => assetIndexSettingsMock(...args),
    },
  },
}));

// why: requirePermission is the auth seam — mocking it lets us pin the
// organizationId returned to the loader for IDOR + tier tests.
// Variadic typed signature satisfies the wrapper's TS2556 contract
// (CR finding on b40fe9dce, route test line 50).
const requirePermissionMock = vi.fn((..._args: unknown[]) => ({}) as unknown);
vi.mock("~/utils/roles.server", () => ({
  PermissionAction: { read: "read", export: "export" } as const,
  PermissionEntity: { asset: "asset" } as const,
  requirePermission: (...args: unknown[]) => requirePermissionMock(...args),
}));

// why: tier read seam — verified real helper at
// apps/webapp/app/modules/tier/service.server.ts:107.
// Variadic typed signature satisfies the wrapper's TS2556 contract.
const getOrganizationTierLimitMock = vi.fn(
  (..._args: unknown[]) => ({}) as unknown
);
vi.mock("~/modules/tier/service.server", () => ({
  getOrganizationTierLimit: (...args: unknown[]) =>
    getOrganizationTierLimitMock(...args),
}));

// why: the asset-query seam — we assert the loader calls this with the
// caller's organizationId (not anything from request input).
// The mock RETURNS the where clause it received so db.asset.findMany
// can org-scope its returned rows (drives A12 behavioral assertion).
const getAssetsWhereInputMock = vi.fn((args: { organizationId: string }) => ({
  organizationId: args.organizationId,
}));
vi.mock("~/modules/asset/utils.server", () => ({
  getAssetsWhereInput: (...args: unknown[]) =>
    getAssetsWhereInputMock(...(args as [{ organizationId: string }])),
}));

// why: assert the existing filename sanitizer is invoked (A9 contract)
const sanitizeFilenameMock = vi.fn((s: string) => s.replace(/[^\w.-]+/g, "_"));
vi.mock("~/utils/sanitize-filename", () => ({
  sanitizeFilename: (...args: unknown[]) =>
    sanitizeFilenameMock(...(args as [string])),
}));

// why: a workspace name will be needed in the A0.b output; pin it via
// requirePermission's organization fixture for cross-test consistency.
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
      },
      role: "ADMIN",
    });
    // Restore sanitizeFilename's default behaviour after clearAllMocks
    sanitizeFilenameMock.mockImplementation((s: string) =>
      s.replace(/[^\w.-]+/g, "_")
    );
    // Restore the default AssetIndexSettings.findFirst behaviour after
    // clearAllMocks so per-test `mockResolvedValueOnce` overrides compose
    // correctly with subsequent calls.
    assetIndexSettingsMock.mockImplementation(async () => ({
      id: "settings-A",
      userId: "user-1",
      organizationId: "org-A",
      columns: USER_COLUMN_FIXTURE,
      freezeColumn: true,
      showAssetImage: true,
    }));
  });

  describe("A0 — loader wiring (permission + tier + filter round-trip)", () => {
    it("A0.a free-tier (canExportAssets=false) → throws 403/ShelfError", async () => {
      console.log("[A0.a] free tier rejected");
      getOrganizationTierLimitMock.mockResolvedValue({
        canExportAssets: false,
      });
      await expect(
        loader(reqFor("https://shelf.test/assets/export/x.pdf") as never)
      ).rejects.toThrow();
    });

    it("A0.b paid-tier (canExportAssets=true) → returns rendered HTML containing workspace name", async () => {
      console.log("[A0.b] paid tier renders");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      // loader returns a Response with text/html body
      expect(res).toBeInstanceOf(Response);
      const html = await (res as Response).text();
      // workspace name pinned via the requirePermission mock above
      expect(html).toContain(WORKSPACE_NAME);
    });

    it("A0.c filter round-trip: getAssetsWhereInput called with the request's currentSearchParams", async () => {
      console.log("[A0.c] filter round-trip");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      await loader(
        reqFor(
          "https://shelf.test/assets/export/x.pdf?location=W1&tag=drill"
        ) as never
      ).catch(() => undefined);
      expect(getAssetsWhereInputMock).toHaveBeenCalled();
      const [call] = getAssetsWhereInputMock.mock.calls;
      const args = call?.[0] as {
        organizationId: string;
        currentSearchParams?: URLSearchParams | string;
      };
      expect(args.organizationId).toBe("org-A");
      // currentSearchParams should carry the filter params from the request
      const sp =
        args.currentSearchParams instanceof URLSearchParams
          ? args.currentSearchParams
          : new URLSearchParams(String(args.currentSearchParams ?? ""));
      expect(sp.get("location")).toBe("W1");
      expect(sp.get("tag")).toBe("drill");
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
      // why: resolve paths relative to THIS test file (not process.cwd()), so
      // the assertion holds regardless of where vitest is invoked from.
      // NOTE: this checks DIRECT imports only — transitive imports are not
      // walked (PRD §15.7 documents this as a deferred caveat; a proper
      // import-graph walker is its own micro-project).
      const here = fileURLToPath(new URL(".", import.meta.url));
      const repoRoot = resolve(here, "../../../.."); // test/routes-tests -> repo root
      const files = [
        "apps/webapp/app/components/assets/assets-index/export-assets-pdf.tsx",
        "apps/webapp/app/routes/_layout+/assets.export.$fileName[.pdf].tsx",
      ];
      for (const f of files) {
        const src = readFileSync(resolve(repoRoot, f), "utf8");
        const forbidden = [
          /@react-pdf\/renderer/,
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
      // Attacker is in org-A but supplies org-B's asset id via search params
      const url = `https://shelf.test/assets/export/x.pdf?assetIds=${ORG_B_ASSET.id}`;
      const res = await loader(reqFor(url) as never);
      expect(res).toBeInstanceOf(Response);
      const html = await (res as Response).text();
      // BEHAVIORAL: org-B's asset id MUST NOT appear in the body
      expect(html).not.toContain(ORG_B_ASSET.id);
      expect(html).not.toContain(ORG_B_ASSET.title);
      // AND org-A's own asset SHOULD appear (proves the loader actually
      // rendered something, not just returned empty — distinguishes
      // "correctly filtered" from "broken and returns nothing")
      expect(html).toContain(ORG_A_ASSET.id);
      // STRUCTURAL backstop: the query was built with the caller's org id,
      // never anything from request input.
      expect(getAssetsWhereInputMock).toHaveBeenCalled();
      const [call] = getAssetsWhereInputMock.mock.calls;
      const args = call?.[0] as { organizationId: string };
      expect(args.organizationId).toBe("org-A");
    });
  });

  describe("A0.d — loader reads AssetIndexSettings.columns (user's columns honored)", () => {
    it("A0.d.1 visible user columns appear in the HTML, in position order; hidden ones absent", async () => {
      console.log("[A0.d.1] AssetIndexSettings columns honored");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      expect(res).toBeInstanceOf(Response);
      const html = await (res as Response).text();
      // C1: labels are DERIVED from columnsLabelsMap by the loader (not
      // taken from a persisted `label` field — the fixture has none).
      // Visible columns: name → "Name", valuation → "Value".
      expect(html).toContain("Value");
      expect(html).toContain("Name");
      // Position order: valuation (position 0) appears BEFORE name (position 1) in DOM.
      // We assert this on the <th> headers via the column key (`valuation` and `name`)
      // baked into the React `key={col.name}` of <th> — search for that to avoid
      // collisions with the generic word "Name" elsewhere.
      const valIdx = html.indexOf('key="valuation"');
      const nameIdx = html.indexOf('key="name"');
      // React strips the `key` from output; fall back to data-asset-id style
      // by checking the cell text in the body row ordering instead.
      const valBodyIdx = html.indexOf("1234"); // ORG_A_ASSET.valuation
      const nameBodyIdx = html.indexOf("AssetInOrgA"); // ORG_A_ASSET.title
      expect(valBodyIdx).toBeGreaterThan(-1);
      expect(nameBodyIdx).toBeGreaterThan(-1);
      // In the body row, valuation cell (column position 0) comes before name (position 1).
      expect(valBodyIdx).toBeLessThan(nameBodyIdx);
      // Use the key-based check only if React did emit them (some test setups do);
      // otherwise the body-order assertion above carries the proof.
      if (valIdx > -1 && nameIdx > -1) {
        expect(valIdx).toBeLessThan(nameIdx);
      }
    });

    it("A0.d.2 (C1 regression) saved column entries with NO label field still render headers", async () => {
      // Codex P1 on commit 3d7ba0589: persisted AssetIndexSettings.columns
      // JSON does not carry `label`; loader must derive via parseColumnName.
      console.log("[A0.d.2] C1 — derived labels render for label-less entries");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // The fixture has NO `label` keys. If the loader regressed to
      // reading `col.label`, headers would render as "undefined" or empty.
      expect(html).not.toContain("undefined");
      // The two derived labels must be present in <th> positions —
      // already asserted in A0.d.1 above. This test additionally asserts
      // the NEGATIVE: no "undefined" string leaks into the document.
    });

    it("A0.d.3 (C2 regression) row values populate for columns beyond id/title/status", async () => {
      // Codex P1 on commit 3d7ba0589: cell rendering reads
      // row.values[col.name] — must cover all supported fixed-field
      // columns, not just the original 5.
      console.log("[A0.d.3] C2 — full row-value coverage");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      assetIndexSettingsMock.mockResolvedValueOnce({
        id: "settings-A",
        userId: "user-1",
        organizationId: "org-A",
        columns: [
          // All visible, sequential positions — exercise the cell mapper
          // for the columns Codex flagged as silently empty.
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
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // Each distinctive value from ORG_A_ASSET must appear in a cell.
      expect(html).toContain("SAM-DISTINCTIVE-0001"); // sequentialId
      expect(html).toContain("DISTINCTIVE-DESC-LOREM"); // description
      expect(html).toContain("1234"); // valuation
      expect(html).toContain("Yes"); // availableToBook → "Yes"
      expect(html).toContain("DISTINCTIVE-KIT-ALPHA"); // kit.name
      expect(html).toContain("DISTINCTIVE-TAG-DRILL"); // tags[0].name
      expect(html).toContain("DISTINCTIVE-TAG-POWER"); // tags[1].name
      expect(html).toContain("DISTINCTIVE-CUSTODIAN-JANE"); // custody.custodian.name
      expect(html).toContain("DISTINCTIVE-QR-ABCDEF"); // qrCodes[0].id
    });
  });

  describe("A0.g — (C3 regression) HTML-escape workspace name in <title>", () => {
    it("A0.g.1 workspace name with HTML injection payload is escaped, not interpolated raw", async () => {
      // Codex P1 on commit 3d7ba0589: workspace names are user-controlled.
      // A name containing `</title><script>` would break out of the title
      // context in the static template (the React body auto-escapes; the
      // surrounding template does not — loader must escape manually).
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
        },
        role: "ADMIN",
      });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // The raw `<script>` substring MUST NOT appear in the title region.
      // We scope by extracting the document head's title and asserting
      // the literal markup is escaped.
      const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
      expect(titleMatch).not.toBeNull();
      const titleInner = titleMatch![1];
      // Escaped form: literal `&lt;script&gt;` (or similar) must be present;
      // the raw `<script>` substring must NOT.
      expect(titleInner).not.toContain("<script>");
      expect(titleInner).toContain("&lt;script&gt;");
      // And the closing `</title>` of the injected payload must be escaped too —
      // otherwise the title context would have closed early.
      expect(titleInner).toContain("&lt;/title&gt;");
    });
  });

  describe("A0.e — filterSummary surfaces in the rendered HTML", () => {
    it("A0.e.1 filter param values from the request appear in the rendered HTML", async () => {
      console.log("[A0.e.1] filter summary surfaces");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      // Use distinctive filter values that can't be confused with anything else
      const res = await loader(
        reqFor(
          "https://shelf.test/assets/export/x.pdf?location=DISTINCTIVE-LOC-XYZ&tag=DISTINCTIVE-TAG-ABC"
        ) as never
      );
      const html = await (res as Response).text();
      // The filter values must surface in the HTML (proves summarizeFilters is wired)
      expect(html).toContain("DISTINCTIVE-LOC-XYZ");
      expect(html).toContain("DISTINCTIVE-TAG-ABC");
    });
  });

  describe("A0.f — includeImages URL param round-trips to thumbnails", () => {
    it("A0.f.1 ?includeImages=true with assets that have thumbnailImage renders <img> elements", async () => {
      console.log("[A0.f.1] includeImages=true renders thumbnails");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor(
          "https://shelf.test/assets/export/x.pdf?includeImages=true"
        ) as never
      );
      const html = await (res as Response).text();
      // ORG_A_ASSET.thumbnailImage is set; with includeImages=true, an <img>
      // referencing that URL (or one derived from it) must appear.
      expect(html).toMatch(/<img\b[^>]*src=/i);
    });

    it("A0.f.2 ?includeImages=false (or absent) renders zero <img>", async () => {
      console.log("[A0.f.2] includeImages absent renders no thumbnails");
      getOrganizationTierLimitMock.mockResolvedValue({ canExportAssets: true });
      const res = await loader(
        reqFor("https://shelf.test/assets/export/x.pdf") as never
      );
      const html = await (res as Response).text();
      // No `?includeImages=true`, so the rendered HTML must contain no <img>
      // tags (the loader passes includeImages=false to the component).
      expect(html).not.toMatch(/<img\b/i);
    });
  });
});
