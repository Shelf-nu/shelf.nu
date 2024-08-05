import { hasNumber } from ".";
import { id } from "./id.server";

describe("id function", () => {
  it("should generate 5000 IDs and ensure each has at least one number", () => {
    const ids = Array.from({ length: 5_000 }, () => id(10));
    ids.forEach((generatedId) => {
      expect(hasNumber(generatedId)).toBe(true);
    });
  });
});
