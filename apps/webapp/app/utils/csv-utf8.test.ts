/**
 * Unit tests for the CSV UTF-8 encoding helpers.
 *
 * These guard the contract every CSV download depends on: the bytes reach
 * the user tagged as UTF-8, both by the leading byte order mark that Excel
 * reads and by the `charset` on the content type. Without the mark, Excel
 * falls back to the machine's locale codepage and non-Latin content (the
 * reporting case is Arabic) opens as mojibake.
 *
 * @see {@link file://./csv-utf8.ts}
 */
import { describe, expect, it } from "vitest";

import { csvResponse, UTF8_BOM, withUtf8Bom } from "./csv-utf8";

/** Arabic sample: the script the reporting export has to survive. */
const ARABIC_CSV = "Group,Asset Count\nحاسوب محمول,12";

/** Reads the first three body bytes of a response, ahead of any decoding. */
async function bodyBytesOf(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer()).slice(0, 3);
}

describe("withUtf8Bom", () => {
  it("prefixes the byte order mark", () => {
    expect(withUtf8Bom(ARABIC_CSV)).toBe(`${UTF8_BOM}${ARABIC_CSV}`);
  });

  it("leaves a document that already carries the mark unchanged", () => {
    expect(withUtf8Bom(`${UTF8_BOM}${ARABIC_CSV}`)).toBe(
      `${UTF8_BOM}${ARABIC_CSV}`
    );
  });

  it("encodes the mark as the three UTF-8 bytes Excel looks for", async () => {
    const bytes = new Uint8Array(
      await new Blob([withUtf8Bom("Group")]).arrayBuffer()
    );

    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("csvResponse", () => {
  it("declares the UTF-8 charset and emits the marked document", async () => {
    const response = csvResponse(ARABIC_CSV);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
    // The body is read as bytes, not via `text()`: UTF-8 decode drops a
    // leading mark, so a decoded body cannot show whether the file the
    // browser writes to disk carries one.
    await expect(bodyBytesOf(response)).resolves.toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf])
    );
  });

  it("keeps the caller's own headers", () => {
    const response = csvResponse(ARABIC_CSV, {
      headers: {
        "content-disposition": 'attachment; filename="distribution.csv"',
        "cache-control": "no-cache",
      },
    });

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="distribution.csv"'
    );
    expect(response.headers.get("cache-control")).toBe("no-cache");
  });

  it("overrides a caller-supplied content type", () => {
    const response = csvResponse(ARABIC_CSV, {
      headers: { "content-type": "text/csv" },
    });

    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8"
    );
  });

  it("round-trips through a UTF-8 decode without mangling the Arabic", async () => {
    // `text()` decodes as UTF-8 and drops the mark, leaving the document.
    await expect(csvResponse(ARABIC_CSV).text()).resolves.toBe(ARABIC_CSV);
  });
});
