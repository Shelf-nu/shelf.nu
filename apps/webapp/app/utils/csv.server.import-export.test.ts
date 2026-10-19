/**
 * Tests for {@link exportAssetsForImportToCsv} (apps/webapp/app/utils/csv.server.ts).
 *
 * Kept in a separate file from `csv.server.test.ts` on purpose: this suite
 * needs a module-level `vi.mock("~/modules/asset/service.server", ...)` to
 * stub the DB-backed asset fetch, and colocating that mock with the shared
 * pure-builder tests in `csv.server.test.ts` risks silently breaking those
 * (unrelated) tests if the mock shape ever drifts.
 *
 * @see {@link file://./csv.server.ts} exportAssetsForImportToCsv
 * @see {@link file://./import-ready-export.server.ts} buildImportReadyCsvFromAssets
 */
import { AssetType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

// why: avoids a real Prisma connection — csv.server.ts imports `db` at
// module scope (via ~/modules/asset/service.server's transitive imports),
// and an unmocked client attempts `void db.$connect()` on import, which
// surfaces as an unhandled rejection in the test run.
vi.mock("~/database/db.server", () => ({
  db: {},
}));
// why: csv.server.ts transitively pulls in a component that renders a
// lottie-react animation; lottie-web crashes in the jsdom/happy-dom test
// environment (no real canvas), so stub the module (matches the sibling
// suite in csv.server.test.ts).
vi.mock("lottie-react", () => ({
  default: () => null,
}));

// why: getAdvancedPaginatedAndFilterableAssets hits the DB; the export logic
// under test is the assembly (column resolution, scope forcing) around it,
// not the query itself.
vi.mock("~/modules/asset/service.server", () => ({
  getAdvancedPaginatedAndFilterableAssets: vi.fn(() =>
    Promise.resolve({
      assets: [
        {
          id: "a1",
          title: "Pens",
          type: AssetType.INDIVIDUAL,
          valuation: 2,
          quantity: 1,
          minQuantity: null,
          unitOfMeasure: null,
          consumptionType: null,
          availableToBook: true,
          assetModelName: null,
          category: null,
          kit: null,
          tags: [],
          location: null,
          custody: null,
          customFields: [],
          barcodes: [],
        },
      ],
    })
  ),
}));

// why: getActiveCustomFields hits the DB; stub one active custom field so
// the test can assert it is surfaced as an importer-native `cf:` header.
vi.mock("~/modules/custom-field/service.server", () => ({
  getActiveCustomFields: vi.fn(() =>
    Promise.resolve([{ name: "Brand", type: "OPTION" }])
  ),
}));

// why: the access rule reads the audit add-on and subscription env; the
// export logic under test only forwards whatever level it resolves.
vi.mock("~/modules/asset/last-audit-date-access.server", () => ({
  lastAuditDateAccessFor: vi.fn(() => "available"),
}));

// why: format prefs are read from the user row in the DB; the export only
// forwards the resolved time zone to the asset query.
vi.mock("./date-format.server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveUserFormatPrefsById: vi.fn(() =>
    Promise.resolve({ timeZone: "Pacific/Auckland" })
  ),
}));

import { getAdvancedPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { exportAssetsForImportToCsv } from "./csv.server";

const ORG = {
  id: "org1",
  barcodesEnabled: false,
  currency: "USD",
  auditsEnabled: true,
} as const;

// why: the mocked access rule ignores it; the export only passes it through.
const ACCESS = {} as never;

describe("exportAssetsForImportToCsv", () => {
  it("produces importer-native headers including active custom fields", async () => {
    const csv = await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      userId: "user-1",
      assetIds: "a1",
      settings: { mode: "ADVANCED", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: null,
      columnScope: "all",
      access: ACCESS,
    });
    const headerLine = csv.split("\r\n")[0];
    expect(headerLine).toContain('"title"');
    expect(headerLine).toContain('"type"');
    expect(headerLine).toContain('"cf:Brand,type:OPTION"');
    expect(headerLine).not.toContain('"qrId"');
  });

  it("forces all columns in SIMPLE index mode even when scope is 'visible'", async () => {
    const csv = await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      userId: "user-1",
      assetIds: "a1",
      settings: { mode: "SIMPLE", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: null,
      columnScope: "visible",
      access: ACCESS,
    });
    // With empty visible columns, "visible" would drop category; "all" keeps it.
    expect(csv.split("\r\n")[0]).toContain('"category"');
  });

  it("exports hand-picked rows whatever their archive state", async () => {
    await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      userId: "user-1",
      assetIds: "a1,a2",
      settings: { mode: "ADVANCED", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: null,
      columnScope: "all",
      access: ACCESS,
    });

    expect(getAdvancedPaginatedAndFilterableAssets).toHaveBeenLastCalledWith(
      expect.objectContaining({ assetIds: ["a1", "a2"], archivedFilter: "all" })
    );
  });

  it("lets a select-all follow the view it was started from", async () => {
    await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      userId: "user-1",
      assetIds: ALL_SELECTED_KEY,
      settings: { mode: "ADVANCED", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: "archived=archived",
      columnScope: "all",
      access: ACCESS,
    });

    expect(getAdvancedPaginatedAndFilterableAssets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        takeAll: true,
        honorArchivedView: true,
        archivedFilter: undefined,
        filters: "archived=archived",
      })
    );
  });

  it("keeps an active last audit date filter when the access is available", async () => {
    await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      userId: "user-1",
      assetIds: ALL_SELECTED_KEY,
      settings: { mode: "ADVANCED", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: "lastAuditDate=isEmpty:",
      columnScope: "all",
      access: ACCESS,
    });

    expect(getAdvancedPaginatedAndFilterableAssets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: "lastAuditDate=isEmpty:",
        lastAuditDateAccess: "available",
      })
    );
  });

  it("resolves select-all date filters in the acting user's time zone", async () => {
    await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      userId: "user-1",
      assetIds: ALL_SELECTED_KEY,
      settings: { mode: "ADVANCED", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: "lastAuditDate=before:2026-08-01",
      columnScope: "all",
      access: ACCESS,
    });

    expect(getAdvancedPaginatedAndFilterableAssets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: "lastAuditDate=before:2026-08-01",
        timeZone: "Pacific/Auckland",
      })
    );
  });
});
