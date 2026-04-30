import { describe, expect, it } from "vitest";
import { AssetModelFormSchema } from "./form";

describe("AssetModelFormSchema", () => {
  it("parses valid asset model data with required fields only", () => {
    const result = AssetModelFormSchema.safeParse({
      name: "Dell Latitude 5550",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Dell Latitude 5550");
      expect(result.data.description).toBeUndefined();
      expect(result.data.defaultValuation).toBeNull();
    }
  });

  it("parses valid data with all optional fields", () => {
    const result = AssetModelFormSchema.safeParse({
      name: "Dell Latitude 5550",
      description: "Standard issue laptop",
      defaultCategoryId: "cat-123",
      defaultValuation: "999.99",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultValuation).toBe(999.99);
      expect(result.data.defaultCategoryId).toBe("cat-123");
    }
  });

  it("transforms empty defaultValuation to null", () => {
    const result = AssetModelFormSchema.safeParse({
      name: "Test Model",
      defaultValuation: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultValuation).toBeNull();
    }
  });

  it("rejects name shorter than 2 characters", () => {
    const result = AssetModelFormSchema.safeParse({
      name: "A",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Name is required");
    }
  });

  it("rejects empty name", () => {
    const result = AssetModelFormSchema.safeParse({
      name: "",
    });

    expect(result.success).toBe(false);
  });

  it("includes preventRedirect for inline dialog mode", () => {
    const result = AssetModelFormSchema.safeParse({
      name: "Test Model",
      preventRedirect: "true",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preventRedirect).toBe("true");
    }
  });
});
