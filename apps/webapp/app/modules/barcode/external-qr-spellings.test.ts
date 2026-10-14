/**
 * Which External QR texts count as one code: URL scheme, `www.`, one trailing
 * slash and host case are ignored, the path and non-link text are not.
 *
 * @see {@link file://./external-qr-spellings.ts}
 */
import {
  externalQrCanonical,
  externalQrSpellings,
} from "./external-qr-spellings";

describe("externalQrCanonical", () => {
  it.each([
    ["example.it/ABC123", "example.it/ABC123"],
    ["http://example.it/ABC123", "example.it/ABC123"],
    ["https://example.it/ABC123", "example.it/ABC123"],
    ["HTTPS://example.it/ABC123", "example.it/ABC123"],
    ["https://www.example.it/ABC123", "example.it/ABC123"],
    ["www.example.it/ABC123", "example.it/ABC123"],
    ["https://example.it/ABC123/", "example.it/ABC123"],
    ["example.it/", "example.it"],
    ["https://example.it/a?b=1#c", "example.it/a?b=1#c"],
    ["http://10.0.0.5:8080/x", "10.0.0.5:8080/x"],
    ["HTTPS://EXAMPLE.IT/ABC123", "example.it/ABC123"],
    ["http://example.it/x?next=/", "example.it/x?next=/"],
    ["https://example.it/x#/", "example.it/x#/"],
  ])("reduces %s to %s", (scanned, canonical) => {
    expect(externalQrCanonical(scanned)).toBe(canonical);
  });

  it("keeps the case of the path", () => {
    expect(externalQrCanonical("https://example.it/AbC")).toBe(
      "example.it/AbC"
    );
  });

  it.each([
    "ABC123",
    "SN-2024-001",
    "Room 4 shelf 2",
    "1.5",
    "https://",
    "mailto:someone@example.it",
  ])("leaves non-URL text %s alone", (text) => {
    expect(externalQrCanonical(text)).toBeNull();
  });
});

describe("externalQrSpellings", () => {
  it("lists every scheme, www, trailing-slash and host-case spelling of a URL", () => {
    expect(externalQrSpellings("https://example.it/ABC123").sort()).toEqual(
      [
        "example.it/ABC123",
        "example.it/ABC123/",
        "www.example.it/ABC123",
        "www.example.it/ABC123/",
        "http://example.it/ABC123",
        "http://example.it/ABC123/",
        "http://www.example.it/ABC123",
        "http://www.example.it/ABC123/",
        "https://example.it/ABC123",
        "https://example.it/ABC123/",
        "https://www.example.it/ABC123",
        "https://www.example.it/ABC123/",
        "EXAMPLE.IT/ABC123",
        "EXAMPLE.IT/ABC123/",
        "www.EXAMPLE.IT/ABC123",
        "www.EXAMPLE.IT/ABC123/",
        "http://EXAMPLE.IT/ABC123",
        "http://EXAMPLE.IT/ABC123/",
        "http://www.EXAMPLE.IT/ABC123",
        "http://www.EXAMPLE.IT/ABC123/",
        "https://EXAMPLE.IT/ABC123",
        "https://EXAMPLE.IT/ABC123/",
        "https://www.EXAMPLE.IT/ABC123",
        "https://www.EXAMPLE.IT/ABC123/",
        "WWW.EXAMPLE.IT/ABC123",
        "WWW.EXAMPLE.IT/ABC123/",
        "HTTP://EXAMPLE.IT/ABC123",
        "HTTP://EXAMPLE.IT/ABC123/",
        "HTTP://WWW.EXAMPLE.IT/ABC123",
        "HTTP://WWW.EXAMPLE.IT/ABC123/",
        "HTTPS://EXAMPLE.IT/ABC123",
        "HTTPS://EXAMPLE.IT/ABC123/",
        "HTTPS://WWW.EXAMPLE.IT/ABC123",
        "HTTPS://WWW.EXAMPLE.IT/ABC123/",
      ].sort()
    );
  });

  it("keeps the scanned text itself when it uses an unusual scheme case", () => {
    expect(externalQrSpellings("HTTPS://example.it/X")).toContain(
      "HTTPS://example.it/X"
    );
  });

  it("never treats a slash at the end of a query as optional", () => {
    const spellings = externalQrSpellings("http://example.it/x?next=/");
    expect(spellings).toContain("https://example.it/x?next=/");
    expect(spellings).not.toContain("https://example.it/x?next=");
  });

  it("includes the fully upper-case spelling a QR encoder may store", () => {
    expect(externalQrSpellings("https://example.it/ABC123")).toContain(
      "HTTPS://EXAMPLE.IT/ABC123"
    );
  });

  it("returns only the text itself for a non-URL code", () => {
    expect(externalQrSpellings("ABC123")).toEqual(["ABC123"]);
  });
});
