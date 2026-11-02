import { describe, expect, it } from "vitest";
import { parseFilters } from "~/modules/asset/filter-parsing";
import { buildAssetIndexFilterHref } from "./filter-href";
import type { Column } from "./helpers";

const columns: Column[] = [{ name: "category", visible: true, position: 0 }];

describe("buildAssetIndexFilterHref", () => {
  it("writes a bare value for the simple index", () => {
    const href = buildAssetIndexFilterHref({
      mode: "SIMPLE",
      key: "category",
      value: "cat-1",
    });

    expect(href).toBe("/assets?category=cat-1");
    expect(new URL(href, "https://x").searchParams.getAll("category")).toEqual([
      "cat-1",
    ]);
  });

  it("writes an `is:` filter the advanced index parses", () => {
    const href = buildAssetIndexFilterHref({
      mode: "ADVANCED",
      key: "category",
      value: "cat-1",
    });

    expect(parseFilters(new URL(href, "https://x").search, columns)).toEqual([
      expect.objectContaining({
        name: "category",
        operator: "is",
        value: "cat-1",
      }),
    ]);
  });

  it("escapes values that would break the query string", () => {
    const href = buildAssetIndexFilterHref({
      mode: "SIMPLE",
      key: "category",
      value: "a&b=c",
    });

    expect(new URL(href, "https://x").searchParams.get("category")).toBe(
      "a&b=c"
    );
  });
});
