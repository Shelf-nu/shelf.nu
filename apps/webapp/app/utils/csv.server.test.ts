import { CustomFieldType } from "@prisma/client";
import {
  MaxFileSizeExceededError,
  parseFormData,
} from "@remix-run/form-data-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCsvBackupDataFromAssets,
  buildCsvExportDataFromAssets,
  buildCsvExportDataFromBookings,
  buildCsvExportDataFromTeamMembers,
  csvDataFromRequest,
  formatValueForCsv,
  parseCsv,
} from "~/utils/csv.server";
import { ShelfError } from "~/utils/error";

// why: mock parseFormData to control file upload parsing in tests
// while keeping MaxFileSizeExceededError available
vi.mock("@remix-run/form-data-parser", async () => {
  const actual = await vi.importActual("@remix-run/form-data-parser");
  return {
    ...(actual as Record<string, unknown>),
    parseFormData: vi.fn(),
  };
});
// why: avoid Prisma connections when importing server utilities
vi.mock("~/database/db.server", () => ({
  db: {},
}));
// why: suppress lottie animation initialization during module imports
vi.mock("lottie-react", () => ({
  default: () => null,
}));

const parseFormDataMock = vi.mocked(parseFormData);

const baseRequest = new Request("http://localhost", {
  headers: {
    "accept-language": "en-US",
    Cookie: "CH-time-zone=UTC",
  },
});

describe("parseCsv", () => {
  it("parses CSV data with detected delimiters and escaped quotes", async () => {
    const csvContent =
      'name;description\n"MacBook ""Pro"" 16";"16-inch laptop"';
    const csvData = new TextEncoder().encode(csvContent).buffer;

    const result = await parseCsv(csvData);

    expect(result).toEqual([
      ["name", "description"],
      ['MacBook "Pro" 16', "16-inch laptop"],
    ]);
  });
});

describe("csvDataFromRequest", () => {
  beforeEach(() => {
    parseFormDataMock.mockReset();
  });

  it("parses CSV data from a valid file upload", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(["name,description\nMacBook Pro 16,Test device"], "assets.csv", {
        type: "text/csv",
      })
    );
    parseFormDataMock.mockResolvedValue(formData);

    const result = await csvDataFromRequest({
      request: new Request("http://localhost/assets/import", {
        method: "POST",
      }),
    });

    expect(result).toEqual([
      ["name", "description"],
      ["MacBook Pro 16", "Test device"],
    ]);
  });

  it("marks CSV parse errors as not captured", async () => {
    const formData = new FormData();
    formData.set(
      "file",
      new File(['name\nMacBook "Pro 16"'], "assets.csv", {
        type: "text/csv",
      })
    );
    parseFormDataMock.mockResolvedValue(formData);

    let thrown: unknown;
    try {
      await csvDataFromRequest({
        request: new Request("http://localhost/assets/import", {
          method: "POST",
        }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const shelfError = thrown as ShelfError;
    expect(shelfError.message).toMatch(/Invalid Opening Quote/i);
    expect(shelfError.shouldBeCaptured).toBe(false);
  });

  it("keeps non-CSV errors captured", async () => {
    parseFormDataMock.mockRejectedValue(new Error("boom"));

    let thrown: unknown;
    try {
      await csvDataFromRequest({
        request: new Request("http://localhost/assets/import", {
          method: "POST",
        }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const shelfError = thrown as ShelfError;
    expect(shelfError.message).toBe(
      "Something went wrong while parsing the CSV file."
    );
    expect(shelfError.shouldBeCaptured).toBe(true);
  });

  it("returns a user-friendly error for file size exceeded", async () => {
    parseFormDataMock.mockRejectedValue(
      new MaxFileSizeExceededError(2 * 1024 * 1024)
    );

    let thrown: unknown;
    try {
      await csvDataFromRequest({
        request: new Request("http://localhost/assets/import", {
          method: "POST",
        }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const shelfError = thrown as ShelfError;
    expect(shelfError.title).toBe("File too large");
    expect(shelfError.message).toMatch(/too large/);
    expect(shelfError.shouldBeCaptured).toBe(false);
  });

  it("detects MaxFileSizeExceededError wrapped in a cause chain", async () => {
    const innerError = new MaxFileSizeExceededError(2 * 1024 * 1024);
    const wrappedError = new Error("Cannot parse form data");
    wrappedError.cause = innerError;
    parseFormDataMock.mockRejectedValue(wrappedError);

    let thrown: unknown;
    try {
      await csvDataFromRequest({
        request: new Request("http://localhost/assets/import", {
          method: "POST",
        }),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ShelfError);
    const shelfError = thrown as ShelfError;
    expect(shelfError.title).toBe("File too large");
    expect(shelfError.shouldBeCaptured).toBe(false);
  });

  it("filters out empty rows from parsed CSV", async () => {
    const csv = [
      "name,description",
      "Asset 1,First asset",
      ",,",
      "",
      "Asset 2,Second asset",
      "  ,  ",
    ].join("\n");

    const formData = new FormData();
    formData.set("file", new File([csv], "assets.csv", { type: "text/csv" }));
    parseFormDataMock.mockResolvedValue(formData);

    const result = await csvDataFromRequest({
      request: new Request("http://localhost/assets/import", {
        method: "POST",
      }),
    });

    expect(result).toEqual([
      ["name", "description"],
      ["Asset 1", "First asset"],
      ["Asset 2", "Second asset"],
    ]);
  });
});

describe("formatValueForCsv", () => {
  it("formats empty values as quoted empty strings", () => {
    expect(formatValueForCsv(null)).toBe('""');
    expect(formatValueForCsv(undefined)).toBe('""');
    expect(formatValueForCsv("")).toBe('""');
  });

  it("formats booleans as yes/no", () => {
    expect(formatValueForCsv(true)).toBe('"Yes"');
    expect(formatValueForCsv(false)).toBe('"No"');
  });

  it("escapes quotes and trims whitespace", () => {
    expect(formatValueForCsv('  He said "hi"  ')).toBe('"He said ""hi"""');
  });

  it("formats dates and strips markdown when requested", () => {
    const dateValue = new Date("2024-01-02T03:04:05Z");
    expect(formatValueForCsv(dateValue)).toBe('"2024-01-02"');

    expect(formatValueForCsv("**Bold** text", true)).toBe('"Bold text"');
  });
});

describe("buildCsvBackupDataFromAssets", () => {
  it("serializes asset data with special handling for relations and text", () => {
    const assets = [
      {
        id: "asset-1",
        description: "Line 1\nLine 2",
        category: null,
        location: null,
        custody: null,
        notes: [{ content: null }],
        tags: [{ name: "tag-1" }],
        customFields: { foo: null },
        serialNumber: null,
        skipMe: "ignore",
      },
    ];

    const result = buildCsvBackupDataFromAssets({
      assets: assets as any,
      keysToSkip: ["skipMe"],
    });

    expect(result).toEqual([
      [
        "asset-1",
        '"Line 1Line 2"',
        "{}",
        "{}",
        "{}",
        '[{"content":""}]',
        '[{"name":"tag-1"}]',
        '{"foo":""}',
        "",
      ],
    ]);
  });
});

describe("buildCsvExportDataFromAssets", () => {
  it("builds ordered CSV rows with fixed and custom field values", () => {
    const assets = [
      {
        id: "asset-1",
        title: "Camera Kit",
        status: "available",
        tags: [{ name: "photo" }, { name: "dslr" }],
        valuation: 1234.5,
        availableToBook: true,
        createdAt: new Date("2024-01-02T03:04:05Z"),
        custody: [
          {
            custodian: {
              name: "Fallback Name",
              user: { firstName: "Jane", lastName: "Doe" },
            },
          },
        ],
        customFields: [
          {
            customField: { name: "isInsured" },
            value: { raw: true, valueBoolean: true },
          },
          {
            customField: { name: "notes" },
            value: { raw: "**Checked** and ready" },
          },
          {
            customField: { name: "purchaseDate" },
            value: { raw: "2024-02-10", valueDate: "2024-02-10" },
          },
          {
            customField: { name: "amount" },
            value: { raw: 5000 },
          },
          {
            customField: { name: "misc" },
            value: { raw: "misc value" },
          },
          {
            customField: { name: "empty" },
            value: { raw: null },
          },
        ],
      },
    ];

    const columns = [
      { name: "name", visible: true, position: 0 },
      { name: "status", visible: true, position: 1 },
      { name: "tags", visible: true, position: 2 },
      { name: "valuation", visible: true, position: 3 },
      { name: "availableToBook", visible: true, position: 4 },
      { name: "createdAt", visible: true, position: 5 },
      { name: "custody", visible: true, position: 6 },
      {
        name: "cf_isInsured",
        visible: true,
        position: 7,
        cfType: CustomFieldType.BOOLEAN,
      },
      {
        name: "cf_notes",
        visible: true,
        position: 8,
        cfType: CustomFieldType.MULTILINE_TEXT,
      },
      {
        name: "cf_purchaseDate",
        visible: true,
        position: 9,
        cfType: CustomFieldType.DATE,
      },
      {
        name: "cf_amount",
        visible: true,
        position: 10,
        cfType: CustomFieldType.AMOUNT,
      },
      { name: "cf_misc", visible: true, position: 11 },
      {
        name: "cf_empty",
        visible: true,
        position: 12,
        cfType: CustomFieldType.TEXT,
      },
      { name: "actions", visible: true, position: 13 },
      { name: "location", visible: false, position: 14 },
    ];

    const [headers, row] = buildCsvExportDataFromAssets({
      assets: assets as any,
      columns: columns as any,
      currentOrganization: {
        id: "org-1",
        barcodesEnabled: false,
        currency: "USD",
      },
      request: baseRequest,
    });

    expect(headers).toEqual([
      '"Name"',
      '"Status"',
      '"Tags"',
      '"Value"',
      '"Available to book"',
      '"Created at"',
      '"Custody"',
      '"isInsured"',
      '"notes"',
      '"purchaseDate"',
      '"amount"',
      '"misc"',
      '"empty"',
    ]);

    expect(row).toEqual([
      '"Camera Kit"',
      '"available"',
      '"photo, dslr"',
      '"$1,234.50"',
      '"Yes"',
      '"2024-01-02T03:04:05.000Z"',
      '"Jane Doe"',
      '"Yes"',
      '"Checked and ready"',
      '"2024-02-10"',
      '"$5,000.00"',
      '"misc value"',
      '""',
    ]);
  });

  it("emits per-unit valuation and qty-aware total_value side by side", () => {
    // QT asset: 100 boxes at €1/each. `valuation` column stays per-unit
    // (CSV round-trip safe — re-import won't inflate it), while the new
    // synthetic `total_value` column reports the qty-aware total (€100).
    const assets = [
      {
        id: "asset-pens",
        title: "Pens",
        valuation: 1,
        quantity: 100,
        type: "QUANTITY_TRACKED",
        unitOfMeasure: "boxes",
        tags: [],
        custody: [],
        customFields: [],
      },
    ];

    const columns = [
      { name: "name", visible: true, position: 0 },
      { name: "valuation", visible: true, position: 1 },
      // Injected by the export caller at MAX_SAFE_INTEGER; here we pin
      // it to position 2 for a stable assertion.
      { name: "total_value", visible: true, position: 2 },
    ];

    const [headers, row] = buildCsvExportDataFromAssets({
      assets: assets as any,
      columns: columns as any,
      currentOrganization: {
        id: "org-1",
        barcodesEnabled: false,
        currency: "USD",
      },
      request: baseRequest,
    });

    expect(headers).toEqual(['"Name"', '"Value"', '"Total value"']);
    expect(row).toEqual(['"Pens"', '"$1.00"', '"$100.00"']);
  });
});

describe("buildCsvExportDataFromBookings", () => {
  it("creates a main booking row and additional asset rows", () => {
    const booking = {
      id: "booking-1",
      name: "Shoot",
      status: "confirmed",
      from: new Date("2024-01-02T03:04:00Z"),
      originalFrom: undefined,
      to: new Date("2024-01-03T03:04:00Z"),
      originalTo: undefined,
      custodianTeamMember: { name: "Custodian", user: null },
      custodianUser: {
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      },
      description: "Studio session",
      tags: [{ name: "commercial" }],
      bookingAssets: [
        { asset: { title: "Primary Asset" } },
        { asset: { title: "Secondary Asset" } },
      ],
    };

    const [headers, bookingRow, assetRow] = buildCsvExportDataFromBookings(
      [booking as any],
      baseRequest
    );

    expect(headers).toEqual([
      "Booking URL",
      "Booking ID",
      "Name",
      "Status",
      "Actual start date",
      "Planned start date",
      "Actual end date",
      "Planned end date",
      "Custodian",
      "Description",
      "Tags",
      "Assets",
      "Item check-in status",
      "Check-in date",
      "Checked in",
      "Total assets",
    ]);

    expect(bookingRow[0]).toBe('"http://localhost:3000/bookings/booking-1"');
    expect(bookingRow[3]).toBe('"Confirmed"');
    expect(bookingRow[5]).toBe(bookingRow[4]);
    expect(bookingRow[7]).toBe(bookingRow[6]);
    expect(bookingRow[8]).toBe('"Jane Doe (jane@example.com)"');
    expect(bookingRow[10]).toBe('"commercial"');
    expect(bookingRow[11]).toBe('"Primary Asset"');

    assetRow.forEach((value, index) => {
      if (index === 11) {
        expect(value).toBe('"Secondary Asset"');
      } else {
        expect(value).toBe('""');
      }
    });
  });

  it("marks each asset checked in/out and rolls up the booking count", () => {
    // why: an OVERDUE booking where one of two assets has been partially
    // checked in — exercises the per-asset status/date columns and the
    // booking-level rollup against real partial check-in input.
    const checkinDate = new Date("2024-01-05T09:30:00Z");
    const booking = {
      id: "booking-2",
      name: "Field shoot",
      status: "OVERDUE",
      from: new Date("2024-01-02T03:04:00Z"),
      originalFrom: undefined,
      to: new Date("2024-01-03T03:04:00Z"),
      originalTo: undefined,
      custodianTeamMember: { name: "Custodian", user: null },
      custodianUser: null,
      description: "",
      tags: [],
      // why: bookings carry their assets via the `BookingAsset` pivot
      // (one row per slice, with a per-slice `quantity`) post-3a, so the
      // CSV builder feeds off `booking.bookingAssets[].asset` not the
      // legacy direct `assets` relation.
      bookingAssets: [
        {
          quantity: 1,
          asset: { id: "asset-returned", title: "Returned Camera" },
        },
        { quantity: 1, asset: { id: "asset-out", title: "Still-Out Tripod" } },
      ],
    };

    const checkinsByBooking = new Map([
      [
        "booking-2",
        {
          checkedInAssetIds: new Set(["asset-returned"]),
          checkinDateByAsset: new Map([["asset-returned", checkinDate]]),
        },
      ],
    ]);

    const [, mainRow, assetRow] = buildCsvExportDataFromBookings(
      [booking as any],
      baseRequest,
      checkinsByBooking
    );

    // Main row carries the first (returned) asset + booking-level rollup.
    expect(mainRow[11]).toBe('"Returned Camera"');
    expect(mainRow[12]).toBe('"Checked in"');
    expect(mainRow[13]).not.toBe('""'); // a formatted check-in date is present
    expect(mainRow[14]).toBe('"1"'); // checked in
    expect(mainRow[15]).toBe('"2"'); // total assets

    // Trailing asset row carries the still-out asset; booking-level columns blank.
    expect(assetRow[11]).toBe('"Still-Out Tripod"');
    expect(assetRow[12]).toBe('"Checked out"');
    expect(assetRow[13]).toBe('""'); // no check-in date for an item still out
    expect(assetRow[14]).toBe('""'); // booking rollup not repeated on asset rows
    expect(assetRow[15]).toBe('""');
  });
});

describe("buildCsvExportDataFromTeamMembers", () => {
  it("returns CSV content with headers and row values", () => {
    const csv = buildCsvExportDataFromTeamMembers({
      teamMembers: [
        { id: "tm-1", name: "Alex", _count: { custodies: 3 } },
        { id: "tm-2", name: "Riley", _count: { custodies: 0 } },
      ] as any,
    });

    expect(csv).toBe(
      ["Id,Name,Custodies", '"tm-1","Alex","3"', '"tm-2","Riley","0"'].join(
        "\r\n"
      )
    );
  });
});
