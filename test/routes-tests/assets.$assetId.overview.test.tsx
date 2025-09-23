import { describe, expect, it } from "vitest";

import { buildCustomFieldLinkHref } from "../../app/utils/custom-field-link";

describe("buildCustomFieldLinkHref", () => {
  it("appends ref parameter when no query is present", () => {
    expect(
      buildCustomFieldLinkHref("https://example.com/products/widget")
    ).toBe("https://example.com/products/widget?ref=shelf-webapp");
  });

  it("preserves existing query parameters when appending ref", () => {
    expect(
      buildCustomFieldLinkHref("https://example.com/products?foo=bar")
    ).toBe("https://example.com/products?foo=bar&ref=shelf-webapp");
  });

  it("places ref before the hash fragment when necessary", () => {
    expect(
      buildCustomFieldLinkHref("https://example.com/products#details")
    ).toBe("https://example.com/products?ref=shelf-webapp#details");
  });

  it("does not duplicate the ref parameter if it already exists", () => {
    expect(
      buildCustomFieldLinkHref(
        "https://example.com/products?ref=shelf-webapp&foo=bar"
      )
    ).toBe("https://example.com/products?ref=shelf-webapp&foo=bar");
  });
});
