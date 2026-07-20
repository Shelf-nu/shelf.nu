import { describe, expect, it } from "vitest";
import { buildExportSearchParams } from "./export-assets-button";

describe("buildExportSearchParams", () => {
  it("includes assetIds, exportType and columnScope", () => {
    const qs = buildExportSearchParams({
      assetIds: ["a1", "a2"],
      allSelected: false,
      currentSearchParams: "category=cpu",
      format: "standard",
      columnScope: "visible",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("assetIds")).toBe("a1,a2");
    expect(params.get("exportType")).toBe("standard");
    expect(params.get("columnScope")).toBe("visible");
    expect(params.get("assetIndexCurrentSearchParams")).toBeNull();
  });

  it("forwards current search params when selecting all", () => {
    const qs = buildExportSearchParams({
      assetIds: ["all-selected"],
      allSelected: true,
      currentSearchParams: "category=cpu",
      format: "import",
      columnScope: "all",
    });
    const params = new URLSearchParams(qs);
    expect(params.get("exportType")).toBe("import");
    expect(params.get("columnScope")).toBe("all");
    expect(params.get("assetIndexCurrentSearchParams")).toBe("category=cpu");
  });
});
