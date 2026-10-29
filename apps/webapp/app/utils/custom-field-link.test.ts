/**
 * Appending Shelf's referrer to a link found in a custom field value.
 *
 * The naive form, `${value}?ref=shelf-webapp`, breaks the two cases a real URL
 * most often has: one that already carries a query string gets a second `?`, and
 * one with a fragment has the parameter swallowed into the fragment, so the
 * referrer is lost and the link can stop resolving.
 *
 * @see {@link file://./custom-field-link.ts}
 */
import { describe, expect, it } from "vitest";

import { buildCustomFieldLinkHref } from "./custom-field-link";

describe("buildCustomFieldLinkHref", () => {
  it("appends the referrer to a plain URL", () => {
    expect(buildCustomFieldLinkHref("https://example.com/docs")).toBe(
      "https://example.com/docs?ref=shelf-webapp"
    );
  });

  it("adds to an existing query string rather than starting a second one", () => {
    expect(buildCustomFieldLinkHref("https://example.com/docs?page=2")).toBe(
      "https://example.com/docs?page=2&ref=shelf-webapp"
    );
  });

  it("keeps a fragment after the query, not around it", () => {
    expect(buildCustomFieldLinkHref("https://example.com/docs#install")).toBe(
      "https://example.com/docs?ref=shelf-webapp#install"
    );
  });

  it("handles a URL with both a query and a fragment", () => {
    expect(
      buildCustomFieldLinkHref("https://example.com/docs?page=2#install")
    ).toBe("https://example.com/docs?page=2&ref=shelf-webapp#install");
  });

  it("keeps the rest of the query exactly as written", () => {
    // A share link's token must reach the service byte for byte.
    expect(
      buildCustomFieldLinkHref(
        "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=4%3aXy+z"
      )
    ).toBe(
      "https://contoso.sharepoint.com/:b:/s/Lab/EaBc12?e=4%3aXy+z&ref=shelf-webapp"
    );
  });

  it("does not add the referrer twice", () => {
    expect(
      buildCustomFieldLinkHref("https://example.com/docs?ref=shelf-webapp")
    ).toBe("https://example.com/docs?ref=shelf-webapp");
  });

  it("preserves a referrer the value already set to something else", () => {
    expect(
      buildCustomFieldLinkHref("https://example.com/docs?ref=partner")
    ).toBe("https://example.com/docs?ref=partner&ref=shelf-webapp");
  });
});
