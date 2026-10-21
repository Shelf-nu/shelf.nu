import { formatAssetCount, formatCount, formatRowCount } from "./format";

describe("asset import count formatting", () => {
  it("adds thousands separators", () => {
    expect(formatCount(5000)).toBe("5,000");
    expect(formatCount(965)).toBe("965");
  });

  it("uses the singular for exactly one", () => {
    expect(formatAssetCount(1)).toBe("1 asset");
    expect(formatRowCount(1)).toBe("1 row");
  });

  it("uses the plural otherwise", () => {
    expect(formatAssetCount(0)).toBe("0 assets");
    expect(formatAssetCount(10000)).toBe("10,000 assets");
    expect(formatRowCount(2)).toBe("2 rows");
  });
});
