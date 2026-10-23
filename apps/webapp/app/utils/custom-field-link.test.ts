/**
 * Appending Shelf's referrer to a custom-field URL.
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
    const href = buildCustomFieldLinkHref("https://example.com/docs?page=2");

    expect(href).toContain("page=2");
    expect(href).toContain("ref=shelf-webapp");
    // A second "?" is what the naive concatenation produces, and it makes the
    // rest of the URL part of one malformed parameter.
    expect(href.match(/\?/g)).toHaveLength(1);
  });

  it("keeps a fragment after the query, not around it", () => {
    const href = buildCustomFieldLinkHref("https://example.com/docs#install");

    expect(href).toBe("https://example.com/docs?ref=shelf-webapp#install");
  });

  it("handles a URL with both a query and a fragment", () => {
    const href = buildCustomFieldLinkHref(
      "https://example.com/docs?page=2#install"
    );

    expect(href).toContain("page=2");
    expect(href).toContain("ref=shelf-webapp");
    expect(href.endsWith("#install")).toBe(true);
    expect(href.match(/\?/g)).toHaveLength(1);
  });

  it("does not add the referrer twice", () => {
    const href = buildCustomFieldLinkHref(
      "https://example.com/docs?ref=shelf-webapp"
    );

    expect(href.match(/ref=shelf-webapp/g)).toHaveLength(1);
  });

  it("preserves a referrer the value already set to something else", () => {
    const href = buildCustomFieldLinkHref(
      "https://example.com/docs?ref=partner"
    );

    expect(href).toContain("ref=partner");
    expect(href).toContain("ref=shelf-webapp");
  });

  it("falls back for a value that is not an absolute URL", () => {
    // Custom field values are free text, so this is ordinary input rather than
    // an edge case.
    const href = buildCustomFieldLinkHref("example.com/docs?page=2#install");

    expect(href).toContain("page=2");
    expect(href).toContain("ref=shelf-webapp");
    expect(href.endsWith("#install")).toBe(true);
    expect(href.match(/\?/g)).toHaveLength(1);
  });
});
