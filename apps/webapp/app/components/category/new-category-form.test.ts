import { describe, expect, it } from "vitest";
import { NewCategoryFormSchema } from "./new-category-form";

const valid = { name: "AV", description: "", color: "#4a90d9" };

describe("NewCategoryFormSchema", () => {
  it("accepts a two-letter name, as CSV imports create them", () => {
    expect(NewCategoryFormSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a blank name with a message", () => {
    const result = NewCategoryFormSchema.safeParse({ ...valid, name: "  " });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Name is required");
  });

  it("refuses a color that is not a six-digit hex with a message", () => {
    const result = NewCategoryFormSchema.safeParse({ ...valid, color: "#abc" });
    expect(result.error?.issues[0].message).toBe(
      "Use a hex color like #4a90d9"
    );
  });
});
