/**
 * Tests for the `labels.csv` shipped in the bulk QR download zip: header,
 * one row per asset, quoting, empty fields, the UTF-8 BOM, and the QR URL with
 * and without a URL shortener configured.
 *
 * @see {@link file://./labels-csv.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UTF8_BOM } from "~/utils/csv-utf8";

const env = vi.hoisted(() => ({ URL_SHORTENER: "" as string }));

// why: URL_SHORTENER is read from the process environment once at import;
// a getter lets each test choose whether a shortener is configured.
vi.mock("~/utils/env", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  get URL_SHORTENER() {
    return env.URL_SHORTENER;
  },
}));

import { buildLabelsCsv, type LabelsCsvAsset } from "./labels-csv.server";

const camera: LabelsCsvAsset = {
  title: 'Canon EOS R5 "Body"',
  sequentialId: "SAM-0001",
  qrId: "cm4abc123",
  category: { name: "Cameras" },
  location: { name: "Studio, Room 2" },
};

const tripod: LabelsCsvAsset = {
  title: "Trípode Manfrotto",
  sequentialId: null,
  qrId: "cm4def456",
  category: null,
  location: null,
};

/** Splits the document into lines after checking and removing the BOM. */
function linesOf(csv: string) {
  expect(csv.startsWith(UTF8_BOM)).toBe(true);
  return csv.slice(UTF8_BOM.length).split("\r\n");
}

describe("buildLabelsCsv", () => {
  beforeEach(() => {
    env.URL_SHORTENER = "";
  });

  it("writes a header and one quoted row per asset, with the shortener URL", () => {
    env.URL_SHORTENER = "eam.sh";

    expect(linesOf(buildLabelsCsv([camera, tripod]))).toEqual([
      '"Asset name","SAM ID","QR ID","QR URL","Category","Location"',
      '"Canon EOS R5 ""Body""","SAM-0001","cm4abc123","https://eam.sh/cm4abc123","Cameras","Studio, Room 2"',
      '"Trípode Manfrotto","","cm4def456","https://eam.sh/cm4def456","",""',
    ]);
  });

  it("points the QR URL at this server's /qr route without a shortener", () => {
    const [, row] = linesOf(buildLabelsCsv([camera]));

    expect(row).toContain('"http://localhost:3000/qr/cm4abc123"');
  });

  it("opens a name that looks like a formula as plain text", () => {
    const [, row] = linesOf(
      buildLabelsCsv([
        {
          ...camera,
          title: '=HYPERLINK("http://evil.example","Click")',
          category: { name: "+cmd" },
          location: { name: "@SUM(A1)" },
        },
      ])
    );

    expect(row.split(",")[0]).toBe(`"'=HYPERLINK(""http://evil.example""`);
    expect(row).toContain(`"'+cmd","'@SUM(A1)"`);
  });

  it("leaves a dash inside a name alone", () => {
    const [, row] = linesOf(
      buildLabelsCsv([{ ...camera, title: "Freezer -80" }])
    );

    expect(row.startsWith('"Freezer -80",')).toBe(true);
  });

  it("prints a signed measurement as typed, with no apostrophe on the label", () => {
    const [, row] = linesOf(
      buildLabelsCsv([
        {
          ...camera,
          title: "-20C Freezer",
          category: { name: "+5V PSU" },
          location: { name: "-2.5 m, Cellar" },
        },
      ])
    );

    expect(row).toBe(
      '"-20C Freezer","SAM-0001","cm4abc123","http://localhost:3000/qr/cm4abc123","+5V PSU","-2.5 m, Cellar"'
    );
  });

  it("still neutralises a signed value that carries formula syntax", () => {
    const [, row] = linesOf(
      buildLabelsCsv([
        {
          ...camera,
          title: "-1+cmd|' /C calc'!A0",
          category: { name: "+1+SUM(A1:A9)" },
          location: { name: "-2*3" },
        },
      ])
    );

    expect(row.startsWith(`"'-1+cmd|' /C calc'!A0",`)).toBe(true);
    expect(row.endsWith(`"'+1+SUM(A1:A9)","'-2*3"`)).toBe(true);
  });

  it("writes only the header for an empty selection", () => {
    expect(linesOf(buildLabelsCsv([]))).toEqual([
      '"Asset name","SAM ID","QR ID","QR URL","Category","Location"',
    ]);
  });
});
