// @vitest-environment node
/**
 * Tests for `collectImportCodeProblems`: every QR code and barcode problem in a
 * file is reported against the rows it affects.
 *
 * @see {@link file://./code-problems.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { collectImportCodeProblems } from "./code-problems.server";

// why: the checks read QR codes and barcodes from the database; the tests
// control what already exists.
vi.mock("~/database/db.server", () => ({
  db: {
    qr: { findMany: vi.fn() },
    barcode: { findMany: vi.fn() },
  },
}));

const qrFindMany = vi.mocked(db.qr.findMany);
const barcodeFindMany = vi.mocked(db.barcode.findMany);

/** Builds a minimal import row. */
function row(overrides: Record<string, string> = {}) {
  return { key: `k-${Math.random()}`, title: "Asset", ...overrides };
}

/** Runs the check against `data` for workspace "org". */
function collect(
  data: Record<string, string>[],
  canUseBarcodes = true
): ReturnType<typeof collectImportCodeProblems> {
  return collectImportCodeProblems({
    data: data as never,
    organizationId: "org",
    canUseBarcodes,
  });
}

/** A QR code row as the database returns it. */
function qr(
  id: string,
  overrides: Partial<{
    assetId: string | null;
    kitId: string | null;
    organizationId: string | null;
  }> = {}
) {
  return {
    id,
    assetId: null,
    kitId: null,
    organizationId: null,
    ...overrides,
  };
}

describe("collectImportCodeProblems", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    qrFindMany.mockResolvedValue([]);
    barcodeFindMany.mockResolvedValue([]);
  });

  it("returns nothing and skips the lookups for a file without codes", async () => {
    expect(await collect([row(), row()])).toEqual([]);
    expect(qrFindMany).not.toHaveBeenCalled();
    expect(barcodeFindMany).not.toHaveBeenCalled();
  });

  it("reports a QR code used on several rows on every one of them", async () => {
    qrFindMany.mockResolvedValue([qr("qr1")] as never);

    const errors = await collect([
      row({ qrId: "qr1" }),
      row(),
      row({ qrId: "qr1" }),
      row({ qrId: "qr1" }),
    ]);

    expect(errors).toEqual([
      {
        row: 2,
        title: "Duplicate QR code",
        message: expect.stringContaining("also used on rows 4 and 5"),
      },
      {
        row: 4,
        title: "Duplicate QR code",
        message: expect.stringContaining("also used on rows 2 and 5"),
      },
      {
        row: 5,
        title: "Duplicate QR code",
        message: expect.stringContaining("also used on rows 2 and 4"),
      },
    ]);
  });

  it("reports a QR code that does not exist", async () => {
    const errors = await collect([row({ qrId: "ghost" })]);

    expect(errors).toEqual([
      {
        row: 2,
        title: "QR code not found",
        message: expect.stringContaining('"ghost"'),
      },
    ]);
  });

  it("reports a QR code already linked to an asset or a kit", async () => {
    qrFindMany.mockResolvedValue([
      qr("onAsset", { assetId: "a1", organizationId: "org" }),
      qr("onKit", { kitId: "k1", organizationId: "org" }),
    ] as never);

    const errors = await collect([
      row({ qrId: "onAsset" }),
      row({ qrId: "onKit" }),
    ]);

    expect(errors.map((e) => [e.row, e.title])).toEqual([
      [2, "QR code already in use"],
      [3, "QR code already in use"],
    ]);
    expect(errors[0].message).toContain("an asset");
    expect(errors[1].message).toContain("a kit");
  });

  it("reports a QR code that belongs to another workspace", async () => {
    qrFindMany.mockResolvedValue([
      qr("foreign", { organizationId: "other" }),
      qr("ours", { organizationId: "org" }),
      qr("unclaimed"),
    ] as never);

    const errors = await collect([
      row({ qrId: "foreign" }),
      row({ qrId: "ours" }),
      row({ qrId: "unclaimed" }),
    ]);

    expect(errors).toEqual([
      {
        row: 2,
        title: "QR code from another workspace",
        message: expect.stringContaining('"foreign"'),
      },
    ]);
  });

  it("reports a barcode its type does not accept", async () => {
    const errors = await collect([row({ barcode_Code128: "AB" })]);

    expect(errors).toEqual([
      {
        row: 2,
        title: "Invalid barcode",
        message: expect.stringContaining('Code128 barcode "AB"'),
      },
    ]);
  });

  it("reports a barcode used on several rows on every one of them", async () => {
    const errors = await collect([
      row({ barcode_Code128: "abcd1234" }),
      row({ barcode_Code39: "ABCD1234" }),
    ]);

    // Values are compared as the importer stores them, so case does not hide
    // a duplicate.
    expect(errors).toEqual([
      {
        row: 2,
        title: "Duplicate barcode",
        message: expect.stringContaining("also used on row 3"),
      },
      {
        row: 3,
        title: "Duplicate barcode",
        message: expect.stringContaining("also used on row 2"),
      },
    ]);
  });

  it("reports a barcode already linked in this workspace, naming the item", async () => {
    barcodeFindMany.mockResolvedValue([
      { value: "ABCD1234", asset: { title: "Camera" }, kit: null },
      { value: "WXYZ9876", asset: null, kit: { name: "Lighting kit" } },
    ] as never);

    const errors = await collect([
      row({ barcode_Code128: "ABCD1234" }),
      row({ barcode_Code128: "WXYZ9876" }),
    ]);

    expect(errors).toEqual([
      {
        row: 2,
        title: "Barcode already in use",
        message: expect.stringContaining('asset "Camera"'),
      },
      {
        row: 3,
        title: "Barcode already in use",
        message: expect.stringContaining('kit "Lighting kit"'),
      },
    ]);
    expect(barcodeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org" }),
      })
    );
  });

  it("does not check barcodes when the workspace has no barcode add-on", async () => {
    const errors = await collect([row({ barcode_Code128: "AB" })], false);

    expect(errors).toEqual([]);
    expect(barcodeFindMany).not.toHaveBeenCalled();
  });

  it("reports several kinds of problem together, ordered by row", async () => {
    qrFindMany.mockResolvedValue([
      qr("linked", { assetId: "a1", organizationId: "org" }),
    ] as never);

    const errors = await collect([
      row({ qrId: "ghost" }),
      row({ barcode_Code128: "AB" }),
      row({ qrId: "linked", barcode_Code128: "SAME1234" }),
      row({ barcode_Code128: "SAME1234" }),
    ]);

    expect(errors.map((e) => [e.row, e.title])).toEqual([
      [2, "QR code not found"],
      [3, "Invalid barcode"],
      [4, "QR code already in use"],
      [4, "Duplicate barcode"],
      [5, "Duplicate barcode"],
    ]);
  });
});
