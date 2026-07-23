import { describe, expect, it } from "vitest";

import { emailMatchesDomains, isValidImageUrl, parseDomains } from "./misc";

/**
 * `isValidImageUrl` is a well-formedness pre-filter for the CSV-import image
 * URL field. It must accept any well-formed http(s) URL — including opaque,
 * extension-less dynamic image endpoints — and reject only malformed strings
 * and non-http(s) protocols. Whether the URL actually yields an image is
 * decided after download (Content-Type + magic bytes), not here, and SSRF
 * safety lives in `safeFetch`, not here. See GHSA-xgrm-8w6v-mvjg.
 */
describe("isValidImageUrl", () => {
  it("accepts dynamic image endpoints with no extension or known host", () => {
    // why: real customer case — ASP.NET handler serving image bytes via a
    // query-string guid, the kind of URL the old string heuristics rejected.
    expect(
      isValidImageUrl(
        "https://rock.kcionline.org/GetImage.ashx?guid=bafe6c61-724b-4c7e-8c49-46a2ec19758e"
      )
    ).toBe(true);
  });

  it("accepts plain http(s) URLs regardless of path or extension", () => {
    expect(isValidImageUrl("https://example.com/photo.jpg")).toBe(true);
    expect(isValidImageUrl("http://example.com/anything")).toBe(true);
    expect(isValidImageUrl("https://example.com")).toBe(true);
  });

  it("rejects non-http(s) protocols", () => {
    expect(isValidImageUrl("ftp://example.com/image.png")).toBe(false);
    expect(isValidImageUrl("javascript:alert(1)")).toBe(false);
    expect(isValidImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isValidImageUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects malformed / empty strings", () => {
    expect(isValidImageUrl("")).toBe(false);
    expect(isValidImageUrl("not a url")).toBe(false);
    expect(isValidImageUrl("example.com/image.png")).toBe(false);
  });
});

describe("parseDomains", () => {
  it("splits, trims and lowercases a comma-separated list", () => {
    expect(parseDomains("Example.com, Foo.IO ,bar.net")).toEqual([
      "example.com",
      "foo.io",
      "bar.net",
    ]);
  });

  it("drops empty segments", () => {
    expect(parseDomains("a.com,, ,b.com")).toEqual(["a.com", "b.com"]);
  });
});

describe("emailMatchesDomains", () => {
  it("matches a domain present in the list (case-insensitive)", () => {
    expect(emailMatchesDomains("Example.com", "example.com,other.com")).toBe(
      true
    );
  });

  it("returns false when the domain is absent", () => {
    expect(emailMatchesDomains("attacker.test", "example.com")).toBe(false);
  });

  it("returns false for empty domain or null list", () => {
    expect(emailMatchesDomains("", "example.com")).toBe(false);
    expect(emailMatchesDomains("example.com", null)).toBe(false);
  });
});
