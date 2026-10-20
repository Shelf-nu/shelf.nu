import { describe, expect, it } from "vitest";

import { isSelfReferer, resolveCancelTo } from "./cancel-destination";

describe("resolveCancelTo", () => {
  it("returns the referer when it points somewhere else", () => {
    expect(
      resolveCancelTo({
        referer: "/assets",
        currentPathname: "/assets/new",
        fallback: "/assets",
      })
    ).toBe("/assets");
  });

  it("preserves the referer's query string so filters survive Cancel", () => {
    // Real flow: filter the list, hit "New asset", cancel -> filtered list.
    expect(
      resolveCancelTo({
        referer: "/assets?search=Laerdal&status=AVAILABLE",
        currentPathname: "/assets/new",
        fallback: "/assets",
      })
    ).toBe("/assets?search=Laerdal&status=AVAILABLE");
  });

  it("falls back when there is no Referer header (null)", () => {
    // Direct URL entry, bookmark, or Referrer-Policy: no-referrer.
    expect(
      resolveCancelTo({
        referer: null,
        currentPathname: "/assets/new",
        fallback: "/assets",
      })
    ).toBe("/assets");
  });

  it("falls back when the route never supplied a referer (undefined)", () => {
    expect(
      resolveCancelTo({
        referer: undefined,
        currentPathname: "/assets/new",
        fallback: "/assets",
      })
    ).toBe("/assets");
  });

  it("falls back when the referer is the current page", () => {
    // Verified repro: picking a Category on /assets/new navigates to
    // /assets/new?category=<id>, whose request carries Referer: /assets/new.
    // Without this guard Cancel links to itself and clicking does nothing.
    expect(
      resolveCancelTo({
        referer: "/assets/new",
        currentPathname: "/assets/new",
        fallback: "/assets",
      })
    ).toBe("/assets");
  });

  it("falls back when the referer is the current page WITH a query string", () => {
    expect(
      resolveCancelTo({
        referer: "/assets/new?category=abc123",
        currentPathname: "/assets/new",
        fallback: "/assets",
      })
    ).toBe("/assets");
  });

  it("does not confuse a prefix match for a self-reference", () => {
    // "/assets" is a prefix of "/assets/new" but is a different page.
    expect(
      resolveCancelTo({
        referer: "/assets",
        currentPathname: "/assets/new",
        fallback: "/fallback",
      })
    ).toBe("/assets");
  });

  it("falls back on an empty-string referer", () => {
    expect(
      resolveCancelTo({
        referer: "",
        currentPathname: "/kits/new",
        fallback: "/kits",
      })
    ).toBe("/kits");
  });
});

describe("isSelfReferer", () => {
  it("matches the same pathname whatever the query string", () => {
    expect(isSelfReferer("/assets/new?category=cat-1", "/assets/new")).toBe(
      true
    );
    expect(isSelfReferer("/assets/new", "/assets/new")).toBe(true);
  });

  it("does not match a different page, even a filtered list", () => {
    expect(isSelfReferer("/assets?search=x", "/assets/new")).toBe(false);
  });
});
