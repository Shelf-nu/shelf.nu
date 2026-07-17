import { AssetType, ConsumptionType, CustomFieldType } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import type { Column } from "~/modules/asset-index-settings/helpers";
import {
  buildImportReadyColumns,
  buildImportReadyCsvFromAssets,
  buildImportReadyRows,
} from "./import-ready-export.server";
import { extractCSVDataFromContentImport } from "./import.server";

// why: avoid Prisma connections when importing server utilities — importing
// ASSET_CSV_HEADERS pulls in ~/modules/asset/utils.server, which transitively
// loads the real db client and fires an un-awaited db.$connect() at module
// scope, producing an unhandled rejection in tests (see csv.server.test.ts
// for the same pattern).
vi.mock("~/database/db.server", () => ({
  db: {},
}));

/** Minimal visible-column config: only name + category visible. */
const VISIBLE_ONLY_COLUMNS: Column[] = [
  { name: "name", visible: true, position: 0 },
  { name: "category", visible: true, position: 1 },
  { name: "custody", visible: false, position: 2 },
  { name: "cf_Brand", visible: false, position: 3 },
];

describe("buildImportReadyColumns", () => {
  it("emits the full importable schema in 'all' scope", () => {
    const columns = buildImportReadyColumns({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [{ name: "Brand", type: CustomFieldType.OPTION }],
      barcodesEnabled: true,
    });
    const headers = columns.map((c) => c.header);

    expect(headers).toEqual([
      "title",
      "description",
      "category",
      "kit",
      "tags",
      "location",
      "custodian",
      "bookable",
      "valuation",
      "assetModel",
      "type",
      "quantity",
      "minQuantity",
      "unitOfMeasure",
      "consumptionType",
      "barcode_Code128",
      "barcode_Code39",
      "barcode_DataMatrix",
      "barcode_ExternalQR",
      "barcode_EAN13",
      "cf:Brand,type:OPTION",
    ]);
  });

  it("omits barcode columns when barcodes are disabled", () => {
    const columns = buildImportReadyColumns({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: false,
    });
    expect(columns.some((c) => c.kind === "barcode")).toBe(false);
  });

  it("in 'visible' scope keeps only visible columns plus the required fields", () => {
    const columns = buildImportReadyColumns({
      columnScope: "visible",
      settingsColumns: VISIBLE_ONLY_COLUMNS,
      activeCustomFields: [{ name: "Brand", type: CustomFieldType.OPTION }],
      barcodesEnabled: true,
    });
    const headers = columns.map((c) => c.header);

    // Required fields are always present…
    expect(headers).toEqual(
      expect.arrayContaining([
        "title",
        "type",
        "quantity",
        "minQuantity",
        "unitOfMeasure",
        "consumptionType",
      ])
    );
    // …the one extra visible column is included…
    expect(headers).toContain("category");
    // …hidden columns are excluded.
    expect(headers).not.toContain("custodian"); // custody column is hidden
    expect(headers).not.toContain("cf:Brand,type:OPTION"); // cf_Brand hidden
  });

  it("only emits headers the content importer accepts", () => {
    const columns = buildImportReadyColumns({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [{ name: "Brand", type: CustomFieldType.OPTION }],
      barcodesEnabled: true,
    });
    for (const { header } of columns) {
      const ok = header.startsWith("cf:") || ASSET_CSV_HEADERS.includes(header);
      expect(ok, `header "${header}" is not importable`).toBe(true);
    }
  });

  it("never emits qrId or imageUrl", () => {
    const columns = buildImportReadyColumns({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: true,
    });
    const headers = columns.map((c) => c.header);
    expect(headers).not.toContain("qrId");
    expect(headers).not.toContain("imageUrl");
  });
});

/**
 * Builds a minimal AdvancedIndexAsset. Only the fields the export reads are
 * populated; the cast documents that this is a deliberate partial.
 */
function makeAsset(
  overrides: Partial<AdvancedIndexAsset> = {}
): AdvancedIndexAsset {
  return {
    id: "asset-1",
    title: "AMD Ryzen",
    description: "CPU",
    type: AssetType.INDIVIDUAL,
    valuation: 100,
    quantity: 1,
    minQuantity: null,
    unitOfMeasure: null,
    consumptionType: null,
    availableToBook: true,
    assetModelName: "Ryzen 9 7950X",
    category: { id: "c1", name: "CPU", color: "#fff" },
    kit: { id: "k1", name: "Home PC" },
    tags: [
      { id: "t1", name: "High priority", color: "#f00" },
      { id: "t2", name: "small", color: "#0f0" },
    ],
    location: { id: "l1", name: "Sofia office" },
    custody: null,
    customFields: [],
    barcodes: [],
    ...overrides,
  } as AdvancedIndexAsset;
}

describe("resolveImportReadyCell / value encoding", () => {
  const columns = buildImportReadyColumns({
    columnScope: "all",
    settingsColumns: [],
    activeCustomFields: [],
    barcodesEnabled: false,
  });
  const headerIndex = (h: string) => columns.findIndex((c) => c.header === h);

  it("encodes core fields in importer-native form", () => {
    const rows = buildImportReadyRows({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: false,
      assets: [makeAsset()],
    });
    const row = rows[1]; // row 0 is headers

    expect(row[headerIndex("title")]).toBe("AMD Ryzen");
    expect(row[headerIndex("category")]).toBe("CPU");
    expect(row[headerIndex("tags")]).toBe("High priority,small");
    expect(row[headerIndex("bookable")]).toBe("yes");
    expect(row[headerIndex("valuation")]).toBe("100"); // plain number, no "$"
    expect(row[headerIndex("type")]).toBe("INDIVIDUAL"); // enum, not "Individual"
  });

  it("uses empty string for an uncategorized asset (not 'Uncategorized')", () => {
    const rows = buildImportReadyRows({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: false,
      assets: [makeAsset({ category: null })],
    });
    expect(rows[1][headerIndex("category")]).toBe("");
  });

  it("emits enum type + consumptionType for quantity-tracked assets", () => {
    const rows = buildImportReadyRows({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: false,
      assets: [
        makeAsset({
          type: AssetType.QUANTITY_TRACKED,
          quantity: 500,
          minQuantity: 50,
          unitOfMeasure: "boxes",
          consumptionType: ConsumptionType.ONE_WAY,
        }),
      ],
    });
    const row = rows[1];
    expect(row[headerIndex("type")]).toBe("QUANTITY_TRACKED");
    expect(row[headerIndex("quantity")]).toBe("500");
    expect(row[headerIndex("minQuantity")]).toBe("50");
    expect(row[headerIndex("unitOfMeasure")]).toBe("boxes");
    expect(row[headerIndex("consumptionType")]).toBe("ONE_WAY");
  });

  it("emits blank quantity for an INDIVIDUAL asset (avoids self-unimportable file)", () => {
    const rows = buildImportReadyRows({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: false,
      assets: [makeAsset({ type: AssetType.INDIVIDUAL, quantity: 5 })],
    });
    expect(rows[1][headerIndex("quantity")]).toBe("");
  });
});

describe("custom-field value encoding", () => {
  function assetWithCf(name: string, value: unknown): AdvancedIndexAsset {
    return makeAsset({
      customFields: [
        {
          id: "acfv-1",
          value: value as never,
          customField: { name } as never,
        },
      ] as never,
    });
  }

  function cfCell(
    cfType: CustomFieldType,
    name: string,
    value: unknown
  ): string {
    const args = {
      columnScope: "all" as const,
      settingsColumns: [],
      activeCustomFields: [{ name, type: cfType }],
      barcodesEnabled: false,
      assets: [assetWithCf(name, value)],
    };
    const columns = buildImportReadyColumns(args);
    const idx = columns.findIndex(
      (c) => c.header === `cf:${name},type:${cfType}`
    );
    return buildImportReadyRows(args)[1][idx];
  }

  it("BOOLEAN -> Yes/No (importer accepts case-insensitively)", () => {
    expect(
      cfCell(CustomFieldType.BOOLEAN, "Active", {
        raw: true,
        valueBoolean: true,
      })
    ).toBe("Yes");
    expect(
      cfCell(CustomFieldType.BOOLEAN, "Active", {
        raw: false,
        valueBoolean: false,
      })
    ).toBe("No");
  });

  it("AMOUNT -> plain number (NOT currency formatted)", () => {
    expect(
      cfCell(CustomFieldType.AMOUNT, "Warranty cost", { raw: 299.99 })
    ).toBe("299.99");
  });

  it("DATE -> YYYY-MM-DD raw string", () => {
    expect(
      cfCell(CustomFieldType.DATE, "Purchase date", {
        raw: "2024-02-22",
        valueDate: "2024-02-22T00:00:00.000Z",
      })
    ).toBe("2024-02-22");
  });

  it("OPTION -> raw option string", () => {
    expect(
      cfCell(CustomFieldType.OPTION, "Brand", {
        raw: "amd",
        valueOption: "amd",
      })
    ).toBe("amd");
  });
});

describe("barcode encoding", () => {
  it("joins multiple barcodes of the same type with a comma", () => {
    const args = {
      columnScope: "all" as const,
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: true,
      assets: [
        makeAsset({
          barcodes: [
            { id: "b1", type: "Code128", value: "MBP001" },
            { id: "b2", type: "Code128", value: "MBP002" },
          ] as never,
        }),
      ],
    };
    const columns = buildImportReadyColumns(args);
    const idx = columns.findIndex((c) => c.header === "barcode_Code128");
    expect(buildImportReadyRows(args)[1][idx]).toBe("MBP001,MBP002");
  });
});

describe("buildImportReadyCsvFromAssets (round-trip)", () => {
  it("produces a file the content importer accepts without defected headers", () => {
    const args = {
      columnScope: "all" as const,
      settingsColumns: [],
      activeCustomFields: [{ name: "Brand", type: CustomFieldType.OPTION }],
      barcodesEnabled: true,
      assets: [
        makeAsset({
          type: AssetType.QUANTITY_TRACKED,
          quantity: 500,
          consumptionType: ConsumptionType.ONE_WAY,
          customFields: [
            {
              id: "acfv-1",
              value: { raw: "amd", valueOption: "amd" } as never,
              customField: { name: "Brand" } as never,
            },
          ] as never,
        }),
      ],
    };

    // Reconstruct the raw string[][] the importer validates (header + data).
    const rows = buildImportReadyRows(args);

    // why: extractCSVDataFromContentImport is the real importer entrypoint —
    // this proves the export re-imports. It throws on any unknown header.
    expect(() =>
      extractCSVDataFromContentImport(rows, [
        // ASSET_CSV_HEADERS — imported at top of file
        ...ASSET_CSV_HEADERS,
      ])
    ).not.toThrow();

    const parsed = extractCSVDataFromContentImport(rows, [
      ...ASSET_CSV_HEADERS,
    ]);
    expect(parsed[0].type).toBe("QUANTITY_TRACKED");
    expect(parsed[0].consumptionType).toBe("ONE_WAY");
    expect(parsed[0]["cf:Brand,type:OPTION"]).toBe("amd");
  });

  it("emits a quoted, CRLF-delimited CSV string", () => {
    const csv = buildImportReadyCsvFromAssets({
      columnScope: "all",
      settingsColumns: [],
      activeCustomFields: [],
      barcodesEnabled: false,
      assets: [makeAsset()],
    });
    expect(csv.split("\r\n")).toHaveLength(2); // header + 1 row
    expect(csv.startsWith('"title"')).toBe(true);
  });
});
