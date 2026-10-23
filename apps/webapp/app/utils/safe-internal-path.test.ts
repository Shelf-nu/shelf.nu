import { describe, it, expect } from "vitest";
import { isInternalPath } from "./safe-internal-path";

describe("isInternalPath", () => {
  it("accepts root-relative in-app paths", () => {
    expect(isInternalPath("/assets/clx123")).toBe(true);
    expect(isInternalPath("/bookings/clx123/overview")).toBe(true);
    expect(isInternalPath("/")).toBe(true);
  });

  it("keeps query strings and fragments on accepted paths", () => {
    expect(isInternalPath("/assets?status=AVAILABLE")).toBe(true);
    expect(isInternalPath("/bookings/1#notes")).toBe(true);
  });

  describe("rejects targets that leave our origin", () => {
    // These are the payloads a Markdoc tag injected through note content would
    // carry. `javascript:` is the headline one, but it is the only variant
    // React blocks on its own — the rest reach the DOM as working links.
    it.each([
      ["javascript scheme", "javascript:alert(1)"],
      ["uppercase scheme", "JavaScript:alert(1)"],
      ["data scheme", "data:text/html,<script>alert(1)</script>"],
      ["vbscript scheme", "vbscript:msgbox(1)"],
      ["absolute url", "https://evil.com/phish"],
      ["protocol-relative", "//evil.com"],
    ])("%s", (_label, payload) => {
      expect(isInternalPath(payload)).toBe(false);
    });

    // Browsers treat "\" like "/" in http(s) URLs, so these resolve off-origin
    // even though they begin with a single "/". A startsWith("//") check misses
    // them entirely — this is why the guard resolves the URL instead.
    it.each([
      ["single backslash", "/\\evil.com"],
      ["double backslash", "/\\\\evil.com"],
    ])("%s", (_label, payload) => {
      expect(isInternalPath(payload)).toBe(false);
    });
  });

  it("rejects internal router routes", () => {
    expect(isInternalPath("/__manifest")).toBe(false);
  });

  it("rejects relative paths and non-strings", () => {
    // Every link our note wrappers emit is root-relative, so anything else is
    // either injected or a bug.
    expect(isInternalPath("assets/clx123")).toBe(false);
    expect(isInternalPath("")).toBe(false);
    expect(isInternalPath(undefined)).toBe(false);
    expect(isInternalPath(null)).toBe(false);
    expect(isInternalPath(42)).toBe(false);
  });
});
