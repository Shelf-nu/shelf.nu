import { describe, expect, it } from "vitest";

import {
  shouldExcludeFromCookie,
  cleanParamsForCookie,
  getValidatedPathname,
  getCookieName,
  checkValueInCookie,
  SEARCH_PARAMS_KEYS_TO_EXCLUDE,
} from "./index";

// @vitest-environment node

describe("search-params helpers", () => {
  describe("shouldExcludeFromCookie", () => {
    it("returns true for excluded keys", () => {
      expect(shouldExcludeFromCookie("page")).toBe(true);
      expect(shouldExcludeFromCookie("scanId")).toBe(true);
      expect(shouldExcludeFromCookie("redirectTo")).toBe(true);
      expect(shouldExcludeFromCookie("getAll")).toBe(true);
    });

    it("returns false for non-excluded keys", () => {
      expect(shouldExcludeFromCookie("status")).toBe(false);
      expect(shouldExcludeFromCookie("category")).toBe(false);
      expect(shouldExcludeFromCookie("search")).toBe(false);
      expect(shouldExcludeFromCookie("customField")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(shouldExcludeFromCookie("Page")).toBe(false);
      expect(shouldExcludeFromCookie("PAGE")).toBe(false);
      expect(shouldExcludeFromCookie("ScanId")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(shouldExcludeFromCookie("")).toBe(false);
    });

    it("returns false for undefined-like strings", () => {
      expect(shouldExcludeFromCookie("undefined")).toBe(false);
      expect(shouldExcludeFromCookie("null")).toBe(false);
    });
  });

  describe("cleanParamsForCookie", () => {
    it("removes all excluded keys from URLSearchParams", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
        page: "2",
        scanId: "scan-123",
        category: "electronics",
        redirectTo: "/assets",
        getAll: "true",
      });

      const result = cleanParamsForCookie(params);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.has("status")).toBe(true);
      expect(cleaned.has("category")).toBe(true);
      expect(cleaned.has("page")).toBe(false);
      expect(cleaned.has("scanId")).toBe(false);
      expect(cleaned.has("redirectTo")).toBe(false);
      expect(cleaned.has("getAll")).toBe(false);
    });

    it("accepts string input and returns cleaned string", () => {
      const paramsString = "status=AVAILABLE&page=3&category=tools&scanId=xyz";
      const result = cleanParamsForCookie(paramsString);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.get("status")).toBe("AVAILABLE");
      expect(cleaned.get("category")).toBe("tools");
      expect(cleaned.has("page")).toBe(false);
      expect(cleaned.has("scanId")).toBe(false);
    });

    it("handles empty params", () => {
      const result = cleanParamsForCookie(new URLSearchParams());
      expect(result).toBe("");
    });

    it("handles empty string input", () => {
      const result = cleanParamsForCookie("");
      expect(result).toBe("");
    });

    it("preserves all parameters when none are excluded", () => {
      const params = new URLSearchParams({
        status: "CHECKED_OUT",
        category: "cameras",
        location: "warehouse",
        search: "canon",
      });

      const result = cleanParamsForCookie(params);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.get("status")).toBe("CHECKED_OUT");
      expect(cleaned.get("category")).toBe("cameras");
      expect(cleaned.get("location")).toBe("warehouse");
      expect(cleaned.get("search")).toBe("canon");
    });

    it("handles params with only excluded keys", () => {
      const params = new URLSearchParams({
        page: "5",
        scanId: "scan-456",
        redirectTo: "/dashboard",
        getAll: "false",
      });

      const result = cleanParamsForCookie(params);
      expect(result).toBe("");
    });

    it("preserves multiple values for the same key", () => {
      const params = new URLSearchParams();
      params.append("tag", "electronics");
      params.append("tag", "borrowed");
      params.append("page", "2");

      const result = cleanParamsForCookie(params);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.getAll("tag")).toEqual(["electronics", "borrowed"]);
      expect(cleaned.has("page")).toBe(false);
    });

    it("handles URL-encoded values correctly", () => {
      const params = new URLSearchParams({
        search: "laptop computer",
        page: "1",
        category: "IT & Equipment",
      });

      const result = cleanParamsForCookie(params);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.get("search")).toBe("laptop computer");
      expect(cleaned.get("category")).toBe("IT & Equipment");
      expect(cleaned.has("page")).toBe(false);
    });

    it("handles special characters in values", () => {
      const params = new URLSearchParams({
        search: "price>100&status=new",
        description: "item #1 & item #2",
        page: "1",
      });

      const result = cleanParamsForCookie(params);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.get("search")).toBe("price>100&status=new");
      expect(cleaned.get("description")).toBe("item #1 & item #2");
      expect(cleaned.has("page")).toBe(false);
    });

    it("is idempotent - cleaning twice produces same result", () => {
      const params = "status=AVAILABLE&page=2&category=tools";
      const firstClean = cleanParamsForCookie(params);
      const secondClean = cleanParamsForCookie(firstClean);

      expect(firstClean).toBe(secondClean);
    });

    it("handles all excluded keys together", () => {
      const params = new URLSearchParams();
      SEARCH_PARAMS_KEYS_TO_EXCLUDE.forEach((key) => {
        params.set(key, "test-value");
      });
      params.set("keepThis", "important");

      const result = cleanParamsForCookie(params);
      const cleaned = new URLSearchParams(result);

      expect(cleaned.get("keepThis")).toBe("important");
      SEARCH_PARAMS_KEYS_TO_EXCLUDE.forEach((key) => {
        expect(cleaned.has(key)).toBe(false);
      });
    });
  });

  describe("getValidatedPathname", () => {
    it("returns 'assetFilter' for /assets path", () => {
      expect(getValidatedPathname("/assets")).toBe("assetFilter");
    });

    it("returns 'bookingFilter' for /bookings path", () => {
      expect(getValidatedPathname("/bookings")).toBe("bookingFilter");
    });

    it("returns 'kitFilter' for /kits path", () => {
      expect(getValidatedPathname("/kits")).toBe("kitFilter");
    });

    it("handles paths without leading slash", () => {
      expect(getValidatedPathname("assets")).toBe("assetFilter");
      expect(getValidatedPathname("bookings")).toBe("bookingFilter");
      expect(getValidatedPathname("kits")).toBe("kitFilter");
    });

    it("handles nested paths by extracting first segment", () => {
      expect(getValidatedPathname("/assets/asset-123/overview")).toBe(
        "assetFilter"
      );
      expect(getValidatedPathname("/bookings/booking-456/details")).toBe(
        "bookingFilter"
      );
      expect(getValidatedPathname("/kits/kit-789/assets")).toBe("kitFilter");
    });

    it("returns 'assetFilter' as fallback for unknown paths", () => {
      expect(getValidatedPathname("/dashboard")).toBe("assetFilter");
      expect(getValidatedPathname("/settings")).toBe("assetFilter");
      expect(getValidatedPathname("/unknown-route")).toBe("assetFilter");
    });

    it("handles empty string", () => {
      expect(getValidatedPathname("")).toBe("assetFilter");
    });

    it("handles single slash", () => {
      expect(getValidatedPathname("/")).toBe("assetFilter");
    });

    it("is case-sensitive", () => {
      expect(getValidatedPathname("/Assets")).toBe("assetFilter");
      expect(getValidatedPathname("/BOOKINGS")).toBe("assetFilter");
      expect(getValidatedPathname("/Kits")).toBe("assetFilter");
    });

    it("handles paths with trailing slashes", () => {
      expect(getValidatedPathname("/assets/")).toBe("assetFilter");
      expect(getValidatedPathname("/bookings/")).toBe("bookingFilter");
    });

    it("handles paths with query strings", () => {
      expect(getValidatedPathname("/assets?status=AVAILABLE")).toBe(
        "assetFilter"
      );
      expect(getValidatedPathname("/bookings?page=2")).toBe("bookingFilter");
    });

    it("handles complex nested routes", () => {
      expect(
        getValidatedPathname("/assets/123/edit?redirectTo=/assets")
      ).toBe("assetFilter");
      expect(getValidatedPathname("/bookings/new/step-2/confirm")).toBe(
        "bookingFilter"
      );
    });
  });

  describe("getCookieName", () => {
    const orgId = "org-abc-123";

    it("returns advanced cookie name when modeIsAdvanced is true", () => {
      expect(getCookieName(orgId, true, "/assets")).toBe(
        "org-abc-123_advancedAssetFilter"
      );
      expect(getCookieName(orgId, true, "/bookings")).toBe(
        "org-abc-123_advancedAssetFilter"
      );
      expect(getCookieName(orgId, true, "/kits")).toBe(
        "org-abc-123_advancedAssetFilter"
      );
    });

    it("returns pathname-specific cookie name when modeIsAdvanced is false", () => {
      expect(getCookieName(orgId, false, "/assets")).toBe(
        "org-abc-123_assetFilter"
      );
      expect(getCookieName(orgId, false, "/bookings")).toBe(
        "org-abc-123_bookingFilter"
      );
      expect(getCookieName(orgId, false, "/kits")).toBe("org-abc-123_kitFilter");
    });

    it("handles nested asset paths correctly", () => {
      expect(getCookieName(orgId, false, "/assets/123/overview")).toBe(
        "org-abc-123_assetFilter"
      );
    });

    it("uses assetFilter as fallback for unknown paths", () => {
      expect(getCookieName(orgId, false, "/dashboard")).toBe(
        "org-abc-123_assetFilter"
      );
      expect(getCookieName(orgId, false, "/settings")).toBe(
        "org-abc-123_assetFilter"
      );
    });

    it("handles different organization IDs", () => {
      expect(getCookieName("org-xyz", false, "/assets")).toBe(
        "org-xyz_assetFilter"
      );
      expect(getCookieName("test-org-456", false, "/bookings")).toBe(
        "test-org-456_bookingFilter"
      );
    });

    it("advanced mode takes precedence over pathname", () => {
      expect(getCookieName(orgId, true, "/assets")).toBe(
        getCookieName(orgId, true, "/bookings")
      );
      expect(getCookieName(orgId, true, "/kits")).toBe(
        getCookieName(orgId, true, "/dashboard")
      );
    });

    it("handles organization IDs with special characters", () => {
      expect(getCookieName("org_123-456", false, "/assets")).toBe(
        "org_123-456_assetFilter"
      );
      expect(getCookieName("org.test", false, "/bookings")).toBe(
        "org.test_bookingFilter"
      );
    });

    it("handles empty pathname", () => {
      expect(getCookieName(orgId, false, "")).toBe("org-abc-123_assetFilter");
    });

    it("produces different names for different paths in non-advanced mode", () => {
      const assetCookie = getCookieName(orgId, false, "/assets");
      const bookingCookie = getCookieName(orgId, false, "/bookings");
      const kitCookie = getCookieName(orgId, false, "/kits");

      expect(assetCookie).not.toBe(bookingCookie);
      expect(bookingCookie).not.toBe(kitCookie);
      expect(kitCookie).not.toBe(assetCookie);
    });
  });

  describe("checkValueInCookie", () => {
    it("returns true when any key exists in params", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
        category: "electronics",
      });

      expect(checkValueInCookie(["status"], params)).toBe(true);
      expect(checkValueInCookie(["category"], params)).toBe(true);
      expect(checkValueInCookie(["status", "category"], params)).toBe(true);
    });

    it("returns false when no keys exist in params", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
        category: "electronics",
      });

      expect(checkValueInCookie(["location"], params)).toBe(false);
      expect(checkValueInCookie(["tag"], params)).toBe(false);
      expect(checkValueInCookie(["location", "tag"], params)).toBe(false);
    });

    it("returns true if at least one key exists", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
        category: "electronics",
      });

      expect(checkValueInCookie(["status", "nonexistent"], params)).toBe(true);
      expect(checkValueInCookie(["nonexistent", "category"], params)).toBe(
        true
      );
    });

    it("returns false for empty key array", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
      });

      expect(checkValueInCookie([], params)).toBe(false);
    });

    it("returns false for empty params", () => {
      const params = new URLSearchParams();

      expect(checkValueInCookie(["status"], params)).toBe(false);
      expect(checkValueInCookie(["status", "category"], params)).toBe(false);
    });

    it("returns true when key exists even with empty value", () => {
      const params = new URLSearchParams();
      params.set("status", "");

      expect(checkValueInCookie(["status"], params)).toBe(true);
    });

    it("handles multiple values for same key", () => {
      const params = new URLSearchParams();
      params.append("tag", "electronics");
      params.append("tag", "borrowed");

      expect(checkValueInCookie(["tag"], params)).toBe(true);
    });

    it("is case-sensitive", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
      });

      expect(checkValueInCookie(["status"], params)).toBe(true);
      expect(checkValueInCookie(["Status"], params)).toBe(false);
      expect(checkValueInCookie(["STATUS"], params)).toBe(false);
    });

    it("handles special characters in keys", () => {
      const params = new URLSearchParams();
      params.set("custom-field-123", "value");
      params.set("filter[type]", "advanced");

      expect(checkValueInCookie(["custom-field-123"], params)).toBe(true);
      expect(checkValueInCookie(["filter[type]"], params)).toBe(true);
    });

    it("checks all keys in array correctly", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
        category: "electronics",
        location: "warehouse",
      });

      expect(
        checkValueInCookie(["status", "category", "location"], params)
      ).toBe(true);
      expect(
        checkValueInCookie(["status", "category", "nonexistent"], params)
      ).toBe(true);
      expect(
        checkValueInCookie(["missing1", "missing2", "missing3"], params)
      ).toBe(false);
    });

    it("returns false for undefined or null-like key names", () => {
      const params = new URLSearchParams({
        status: "AVAILABLE",
      });

      expect(checkValueInCookie(["undefined"], params)).toBe(false);
      expect(checkValueInCookie(["null"], params)).toBe(false);
    });

    it("handles URL-encoded key names", () => {
      const params = new URLSearchParams();
      params.set("search query", "laptop");

      expect(checkValueInCookie(["search query"], params)).toBe(true);
    });
  });
});