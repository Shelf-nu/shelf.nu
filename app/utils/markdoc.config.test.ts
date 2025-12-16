import { markdocConfig } from "./markdoc.config";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe("markdoc.config", () => {
  beforeEach(() => {
    // Ensure config is properly loaded
    expect(markdocConfig).toBeDefined();
    expect(markdocConfig.tags as any).toBeDefined();
  });

  describe("configuration structure", () => {
    it("should have a valid config object", () => {
      expect(markdocConfig).toBeDefined();
      expect(typeof markdocConfig).toBe("object");
    });

    it("should have tags configuration", () => {
      expect(markdocConfig.tags as any).toBeDefined();
      expect(typeof (markdocConfig.tags as any)).toBe("object");
    });
  });

  describe("date tag configuration", () => {
    it("should have date tag with correct properties", () => {
      const dateTag = (markdocConfig.tags as any as any).date;

      expect(dateTag).toBeDefined();
      expect(dateTag.render).toBe("DateComponent");
      expect(dateTag.attributes).toBeDefined();
    });

    it("should have correct date tag attributes", () => {
      const dateAttributes = (markdocConfig.tags as any as any).date.attributes;

      expect(dateAttributes).toBeDefined();
      expect(dateAttributes.value).toEqual(
        expect.objectContaining({
          type: String,
          required: true,
        })
      );

      expect(dateAttributes.includeTime).toEqual(
        expect.objectContaining({
          type: Boolean,
          default: true,
        })
      );
    });
  });

  describe("assets_list tag configuration", () => {
    it("should have assets_list tag with correct properties", () => {
      const assetsListTag = (markdocConfig.tags as any as any).assets_list;

      expect(assetsListTag).toBeDefined();
      expect(assetsListTag.render).toBe("AssetsListComponent");
      expect(assetsListTag.attributes).toBeDefined();
    });

    it("should have correct assets_list tag attributes", () => {
      const assetsListAttributes = (markdocConfig.tags as any as any)
        .assets_list.attributes;

      expect(assetsListAttributes).toBeDefined();
      expect(assetsListAttributes.count).toEqual(
        expect.objectContaining({
          type: Number,
          required: true,
        })
      );

      expect(assetsListAttributes.ids).toEqual(
        expect.objectContaining({
          type: String,
          required: true,
        })
      );

      expect(assetsListAttributes.action).toEqual(
        expect.objectContaining({
          type: String,
          required: true,
        })
      );
    });
  });

  describe("kits_list tag configuration", () => {
    it("should have kits_list tag with correct properties", () => {
      const kitsListTag = (markdocConfig.tags as any).kits_list;

      expect(kitsListTag).toBeDefined();
      expect(kitsListTag.render).toBe("KitsListComponent");
      expect(kitsListTag.attributes).toBeDefined();
    });

    it("should have correct kits_list tag attributes", () => {
      const kitsListAttributes = (markdocConfig.tags as any).kits_list
        .attributes;

      expect(kitsListAttributes).toBeDefined();
      expect(kitsListAttributes!.count).toEqual(
        expect.objectContaining({
          type: Number,
          required: true,
        })
      );

      expect(kitsListAttributes!.ids).toEqual(
        expect.objectContaining({
          type: String,
          required: true,
        })
      );

      expect(kitsListAttributes!.action).toEqual(
        expect.objectContaining({
          type: String,
          required: true,
        })
      );
    });
  });

  describe("booking_status tag configuration", () => {
    it("should have booking_status tag with correct properties", () => {
      const bookingStatusTag = (markdocConfig.tags as any).booking_status;

      expect(bookingStatusTag).toBeDefined();
      expect(bookingStatusTag.render).toBe("BookingStatusComponent");
      expect(bookingStatusTag.attributes).toBeDefined();
    });

    it("should have correct booking_status tag attributes", () => {
      const bookingStatusAttributes = (markdocConfig.tags as any).booking_status
        .attributes;

      expect(bookingStatusAttributes).toBeDefined();
      expect(bookingStatusAttributes.status).toEqual(
        expect.objectContaining({
          type: String,
          required: true,
        })
      );

      expect(bookingStatusAttributes.custodianUserId).toEqual(
        expect.objectContaining({
          type: String,
          required: false,
        })
      );
    });
  });

  describe("tag completeness", () => {
    it("should have all expected tags", () => {
      const expectedTags = [
        "raw",
        "date",
        "assets_list",
        "kits_list",
        "link",
        "booking_status",
        "description",
        "tag",
        "category_badge",
        "audit_images",
      ];
      const actualTags = Object.keys(markdocConfig.tags as any);

      expectedTags.forEach((tag) => {
        expect(actualTags).toContain(tag);
      });
    });

    it("should not have unexpected tags", () => {
      const expectedTags = [
        "raw",
        "date",
        "assets_list",
        "kits_list",
        "link",
        "booking_status",
        "description",
        "tag",
        "category_badge",
        "audit_images",
      ];
      const actualTags = Object.keys(markdocConfig.tags as any);

      expect(actualTags).toHaveLength(expectedTags.length);
    });
  });

  describe("attribute types", () => {
    it("should use correct attribute types for all tags", () => {
      // Check that all string attributes use String constructor
      expect((markdocConfig.tags as any).date.attributes.value.type).toBe(
        String
      );
      expect((markdocConfig.tags as any).assets_list.attributes.ids.type).toBe(
        String
      );
      expect(
        (markdocConfig.tags as any).assets_list.attributes.action.type
      ).toBe(String);
      expect((markdocConfig.tags as any).kits_list.attributes.ids.type).toBe(
        String
      );
      expect((markdocConfig.tags as any).kits_list.attributes.action.type).toBe(
        String
      );
      expect((markdocConfig.tags as any).link.attributes.to.type).toBe(String);
      expect((markdocConfig.tags as any).link.attributes.text.type).toBe(
        String
      );
      expect(
        (markdocConfig.tags as any).booking_status.attributes.status.type
      ).toBe(String);
      expect(
        (markdocConfig.tags as any).booking_status.attributes.custodianUserId
          .type
      ).toBe(String);
      expect(
        (markdocConfig.tags as any).description.attributes.oldText.type
      ).toBe(String);
      expect(
        (markdocConfig.tags as any).description.attributes.newText.type
      ).toBe(String);

      // Check that all boolean attributes use Boolean constructor
      expect((markdocConfig.tags as any).date.attributes.includeTime.type).toBe(
        Boolean
      );

      // Check that all number attributes use Number constructor
      expect(
        (markdocConfig.tags as any).assets_list.attributes.count.type
      ).toBe(Number);
      expect((markdocConfig.tags as any).kits_list.attributes.count.type).toBe(
        Number
      );
    });
  });

  describe("required attributes", () => {
    it("should mark correct attributes as required", () => {
      // Date tag - value is required, includeTime is optional with default
      expect((markdocConfig.tags as any).date.attributes.value.required).toBe(
        true
      );
      expect(
        (markdocConfig.tags as any).date.attributes.includeTime.required
      ).toBeUndefined();

      // Assets list tag - all attributes are required
      expect(
        (markdocConfig.tags as any).assets_list.attributes.count.required
      ).toBe(true);
      expect(
        (markdocConfig.tags as any).assets_list.attributes.ids.required
      ).toBe(true);
      expect(
        (markdocConfig.tags as any).assets_list.attributes.action.required
      ).toBe(true);

      // Kits list tag - all attributes are required
      expect(
        (markdocConfig.tags as any).kits_list.attributes.count.required
      ).toBe(true);
      expect(
        (markdocConfig.tags as any).kits_list.attributes.ids.required
      ).toBe(true);
      expect(
        (markdocConfig.tags as any).kits_list.attributes.action.required
      ).toBe(true);

      // Booking status tag - status is required, custodianUserId is optional
      expect(
        (markdocConfig.tags as any).booking_status.attributes.status.required
      ).toBe(true);
      expect(
        (markdocConfig.tags as any).booking_status.attributes.custodianUserId
          .required
      ).toBe(false);
    });
  });

  describe("default values", () => {
    it("should have correct default values", () => {
      // Only includeTime should have a default value
      expect(
        (markdocConfig.tags as any).date.attributes.includeTime.default
      ).toBe(true);

      // Other attributes should not have defaults
      expect(
        (markdocConfig.tags as any).date.attributes.value.default
      ).toBeUndefined();
      expect(
        (markdocConfig.tags as any).assets_list.attributes.count.default
      ).toBeUndefined();
      expect(
        (markdocConfig.tags as any).assets_list.attributes.ids.default
      ).toBeUndefined();
      expect(
        (markdocConfig.tags as any).assets_list.attributes.action.default
      ).toBeUndefined();
      expect(
        (markdocConfig.tags as any).kits_list.attributes.count.default
      ).toBeUndefined();
      expect(
        (markdocConfig.tags as any).kits_list.attributes.ids.default
      ).toBeUndefined();
      expect(
        (markdocConfig.tags as any).kits_list.attributes.action.default
      ).toBeUndefined();
    });
  });
});
