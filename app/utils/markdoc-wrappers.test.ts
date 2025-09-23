import {
  wrapDateForNote,
  wrapAssetsForNote,
  wrapKitsForNote,
  wrapAssetsWithDataForNote,
  wrapKitsWithDataForNote,
  extractDateTags,
  extractAssetsListTags,
  DATE_TAG_REGEX,
  ASSETS_LIST_TAG_REGEX,
} from "./markdoc-wrappers";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe("markdoc-wrappers", () => {
  describe("wrapDateForNote", () => {
    it("should wrap date with Markdoc date tag", () => {
      const date = new Date("2023-12-25T10:30:00.000Z");
      const result = wrapDateForNote(date);

      expect(result).toBe('{% date value="2023-12-25T10:30:00.000Z" /%}');
    });

    it("should handle includeTime parameter", () => {
      const date = new Date("2023-12-25T10:30:00.000Z");
      const result = wrapDateForNote(date, false);

      expect(result).toBe(
        '{% date value="2023-12-25T10:30:00.000Z" includeTime=false /%}'
      );
    });

    it("should omit includeTime when true (default behavior)", () => {
      const date = new Date("2023-12-25T10:30:00.000Z");
      const result = wrapDateForNote(date, true);

      expect(result).toBe('{% date value="2023-12-25T10:30:00.000Z" /%}');
    });
  });

  describe("wrapAssetsForNote", () => {
    it("should wrap single asset ID", () => {
      const assetIds = ["asset-1"];
      const result = wrapAssetsForNote(assetIds, "added");

      expect(result).toBe(
        '{% assets_list count=1 ids="asset-1" action="added" /%}'
      );
    });

    it("should wrap multiple asset IDs", () => {
      const assetIds = ["asset-1", "asset-2", "asset-3"];
      const result = wrapAssetsForNote(assetIds, "removed");

      expect(result).toBe(
        '{% assets_list count=3 ids="asset-1,asset-2,asset-3" action="removed" /%}'
      );
    });

    it("should default action to 'added'", () => {
      const assetIds = ["asset-1"];
      const result = wrapAssetsForNote(assetIds);

      expect(result).toBe(
        '{% assets_list count=1 ids="asset-1" action="added" /%}'
      );
    });

    it("should handle empty array", () => {
      const assetIds: string[] = [];
      const result = wrapAssetsForNote(assetIds, "added");

      expect(result).toBe('{% assets_list count=0 ids="" action="added" /%}');
    });
  });

  describe("wrapKitsForNote", () => {
    it("should wrap single kit ID", () => {
      const kitIds = ["kit-1"];
      const result = wrapKitsForNote(kitIds, "added");

      expect(result).toBe(
        '{% kits_list count=1 ids="kit-1" action="added" /%}'
      );
    });

    it("should wrap multiple kit IDs", () => {
      const kitIds = ["kit-1", "kit-2"];
      const result = wrapKitsForNote(kitIds, "removed");

      expect(result).toBe(
        '{% kits_list count=2 ids="kit-1,kit-2" action="removed" /%}'
      );
    });

    it("should default action to 'added'", () => {
      const kitIds = ["kit-1"];
      const result = wrapKitsForNote(kitIds);

      expect(result).toBe(
        '{% kits_list count=1 ids="kit-1" action="added" /%}'
      );
    });
  });

  describe("wrapAssetsWithDataForNote", () => {
    it("should handle single asset with direct link", () => {
      const asset = { id: "asset-1", title: "Laptop" };
      const result = wrapAssetsWithDataForNote(asset, "added");

      expect(result).toBe("**[Laptop](/assets/asset-1)**");
    });

    it("should handle multiple assets with tag", () => {
      const assets = [
        { id: "asset-1", title: "Laptop" },
        { id: "asset-2", title: "Mouse" },
      ];
      const result = wrapAssetsWithDataForNote(assets, "removed");

      expect(result).toBe(
        '{% assets_list count=2 ids="asset-1,asset-2" action="removed" /%}'
      );
    });

    it("should handle array with single asset", () => {
      const assets = [{ id: "asset-1", title: "Laptop" }];
      const result = wrapAssetsWithDataForNote(assets, "added");

      expect(result).toBe("**[Laptop](/assets/asset-1)**");
    });

    it("should handle empty array", () => {
      const assets: Array<{ id: string; title: string }> = [];
      const result = wrapAssetsWithDataForNote(assets, "added");

      expect(result).toBe('{% assets_list count=0 ids="" action="added" /%}');
    });
  });

  describe("wrapKitsWithDataForNote", () => {
    it("should handle single kit with direct link", () => {
      const kit = { id: "kit-1", name: "Photography Kit" };
      const result = wrapKitsWithDataForNote(kit, "added");

      expect(result).toBe("**[Photography Kit](/kits/kit-1)**");
    });

    it("should handle multiple kits with tag", () => {
      const kits = [
        { id: "kit-1", name: "Photography Kit" },
        { id: "kit-2", name: "Video Kit" },
      ];
      const result = wrapKitsWithDataForNote(kits, "removed");

      expect(result).toBe(
        '{% kits_list count=2 ids="kit-1,kit-2" action="removed" /%}'
      );
    });

    it("should handle array with single kit", () => {
      const kits = [{ id: "kit-1", name: "Photography Kit" }];
      const result = wrapKitsWithDataForNote(kits, "added");

      expect(result).toBe("**[Photography Kit](/kits/kit-1)**");
    });
  });

  describe("extractDateTags", () => {
    it("should extract dates from date tags", () => {
      const content =
        'Booking extended from {% date value="2023-12-25T10:30:00.000Z" /%} to {% date value="2023-12-26T15:45:00.000Z" includeTime=false /%}';
      const result = extractDateTags(content);

      expect(result).toEqual([
        "2023-12-25T10:30:00.000Z",
        "2023-12-26T15:45:00.000Z",
      ]);
    });

    it("should return empty array if no date tags found", () => {
      const content = "No date tags in this content";
      const result = extractDateTags(content);

      expect(result).toEqual([]);
    });

    it("should handle mixed content with other tags", () => {
      const content =
        'Added {% assets_list count=2 ids="asset-1,asset-2" action="added" /%} on {% date value="2023-12-25T10:30:00.000Z" /%}';
      const result = extractDateTags(content);

      expect(result).toEqual(["2023-12-25T10:30:00.000Z"]);
    });
  });

  describe("extractAssetsListTags", () => {
    it("should extract asset list information from tags", () => {
      const content =
        'Added {% assets_list count=3 ids="asset-1,asset-2,asset-3" action="added" /%} and removed {% assets_list count=1 ids="asset-4" action="removed" /%}';
      const result = extractAssetsListTags(content);

      expect(result).toEqual([
        {
          count: 3,
          ids: ["asset-1", "asset-2", "asset-3"],
          action: "added",
        },
        {
          count: 1,
          ids: ["asset-4"],
          action: "removed",
        },
      ]);
    });

    it("should return empty array if no asset list tags found", () => {
      const content = "No asset list tags in this content";
      const result = extractAssetsListTags(content);

      expect(result).toEqual([]);
    });

    it("should handle mixed content with other tags", () => {
      const content =
        'Booking scheduled for {% date value="2023-12-25T10:30:00.000Z" /%} with {% assets_list count=2 ids="asset-1,asset-2" action="added" /%}';
      const result = extractAssetsListTags(content);

      expect(result).toEqual([
        {
          count: 2,
          ids: ["asset-1", "asset-2"],
          action: "added",
        },
      ]);
    });
  });

  describe("Regular expressions", () => {
    describe("DATE_TAG_REGEX", () => {
      it("should match date tags with and without includeTime", () => {
        const content =
          '{% date value="2023-12-25T10:30:00.000Z" /%} and {% date value="2023-12-26T15:45:00.000Z" includeTime=false /%}';
        const matches = Array.from(content.matchAll(DATE_TAG_REGEX));

        expect(matches).toHaveLength(2);
        expect(matches[0][1]).toBe("2023-12-25T10:30:00.000Z");
        expect(matches[0][2]).toBeUndefined(); // includeTime not specified
        expect(matches[1][1]).toBe("2023-12-26T15:45:00.000Z");
        expect(matches[1][2]).toBe("false");
      });

      it("should not match malformed date tags", () => {
        const content = "{% date invalid /%}";
        const matches = Array.from(content.matchAll(DATE_TAG_REGEX));

        expect(matches).toHaveLength(0);
      });
    });

    describe("ASSETS_LIST_TAG_REGEX", () => {
      it("should match assets_list tags", () => {
        const content =
          '{% assets_list count=3 ids="asset-1,asset-2,asset-3" action="added" /%}';
        const matches = Array.from(content.matchAll(ASSETS_LIST_TAG_REGEX));

        expect(matches).toHaveLength(1);
        expect(matches[0][1]).toBe("3");
        expect(matches[0][2]).toBe("asset-1,asset-2,asset-3");
        expect(matches[0][3]).toBe("added");
      });

      it("should not match malformed assets_list tags", () => {
        const content = "{% assets_list invalid /%}";
        const matches = Array.from(content.matchAll(ASSETS_LIST_TAG_REGEX));

        expect(matches).toHaveLength(0);
      });
    });
  });
});
