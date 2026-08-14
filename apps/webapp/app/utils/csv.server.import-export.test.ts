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

import { exportAssetsForImportToCsv } from "./csv.server";

const ORG = { id: "org1", barcodesEnabled: false, currency: "USD" } as const;

describe("exportAssetsForImportToCsv", () => {
  it("produces importer-native headers including active custom fields", async () => {
    const csv = await exportAssetsForImportToCsv({
      request: new Request("http://localhost/assets/export/x.csv"),
      assetIds: "a1",
      settings: { mode: "ADVANCED", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: null,
      columnScope: "all",
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
      assetIds: "a1",
      settings: { mode: "SIMPLE", columns: [] } as never,
      currentOrganization: ORG,
      assetIndexCurrentSearchParams: null,
      columnScope: "visible",
    });
    // With empty visible columns, "visible" would drop category; "all" keeps it.
    expect(csv.split("\r\n")[0]).toContain('"category"');
  });
});
