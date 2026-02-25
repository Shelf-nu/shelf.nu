import { z } from "zod";
import type { ShelfError } from "./error";
import { getValidationErrors } from "./http";
import { parseData } from "./http.server";

// @vitest-environment node
// 👋 see https://vitest.dev/guide/environment.html#environments-for-specific-files

describe(getValidationErrors.name, () => {
  it("should return validation error", () => {
    const schema = z.object({ id: z.string() });
    try {
      parseData({}, schema);
    } catch (e) {
      const error = e as ShelfError;

      const validationErrors = getValidationErrors<typeof schema>(error);

      // we explicitly use validationErrors?.id to test that inference works
      expect(validationErrors?.id).toEqual({
        message: "Required",
      });
    }
  });

  it("should return nothing if the error has no validation errors", () => {
    const schema = z.object({ id: z.string() });
    try {
      parseData({}, schema);
    } catch (e) {
      const error = e as ShelfError;

      const validationErrors = getValidationErrors<typeof schema>(error);

      // we explicitly use validationErrors?.id to test that inference works
      expect(validationErrors?.id).toEqual({
        message: "Required",
      });
    }
  });
});
