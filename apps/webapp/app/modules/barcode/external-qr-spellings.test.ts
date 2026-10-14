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
  it("lists every scheme, www and trailing-slash spelling of a URL", () => {
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
      ].sort()
    );
  });

  it("keeps the scanned text itself when it uses an unusual scheme case", () => {
    expect(externalQrSpellings("HTTPS://example.it/X")).toContain(
      "HTTPS://example.it/X"
    );
  });

  it("returns only the text itself for a non-URL code", () => {
    expect(externalQrSpellings("ABC123")).toEqual(["ABC123"]);
  });
});
