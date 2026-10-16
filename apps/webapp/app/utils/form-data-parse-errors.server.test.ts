/**
 * Recognising a too-large upload through the wrapper the parser throws.
 *
 * The case that matters is the wrapped one: `parseFormData` rethrows every
 * underlying failure as a `FormDataParseError` carrying the real error on
 * `.cause`, so a caller testing the thrown value directly sees only the wrapper
 * and answers with its generic error instead of the size message.
 *
 * @see {@link file://./form-data-parse-errors.server.ts}
 */
import {
  FormDataParseError,
  MaxFileSizeExceededError,
} from "@remix-run/form-data-parser";
import { describe, expect, it } from "vitest";

import {
  getMaxFileSizeExceededError,
  isMaxFileSizeError,
} from "./form-data-parse-errors.server";

const oversized = new MaxFileSizeExceededError(4 * 1024 * 1024);

/** How `parseFormData` actually delivers it. */
const wrapped = new FormDataParseError("Cannot parse form data", {
  cause: oversized,
});

describe("getMaxFileSizeExceededError", () => {
  it("finds the error inside the wrapper the parser throws", () => {
    expect(getMaxFileSizeExceededError(wrapped)).toBe(oversized);
  });

  it("finds it when thrown directly", () => {
    expect(getMaxFileSizeExceededError(oversized)).toBe(oversized);
  });

  it("finds it further down a chain of causes", () => {
    const rethrown = new Error("upload failed", { cause: wrapped });

    expect(getMaxFileSizeExceededError(rethrown)).toBe(oversized);
  });

  it("answers null for a parse that failed for another reason", () => {
    const malformed = new FormDataParseError("Cannot parse form data", {
      cause: new Error("Unexpected end of multipart body"),
    });

    expect(getMaxFileSizeExceededError(malformed)).toBeNull();
  });

  it.each([
    ["a bare error", new Error("boom")],
    ["null", null],
    ["undefined", undefined],
    ["a string", "boom"],
    ["an object with no cause", { message: "boom" }],
  ])("answers null for %s", (_label, input) => {
    expect(getMaxFileSizeExceededError(input)).toBeNull();
  });

  it("terminates on a cause that points at itself", () => {
    // A self-referential cause would otherwise recurse forever. `cause` is read
    // once per level and a cycle reaches a value already seen, so the walk has to
    // stop rather than hang the request.
    const looped: { cause?: unknown } = {};
    looped.cause = looped;

    expect(() => getMaxFileSizeExceededError(looped)).not.toThrow();
  });
});

describe("isMaxFileSizeError", () => {
  it("is true for the wrapped shape and false otherwise", () => {
    expect(isMaxFileSizeError(wrapped)).toBe(true);
    expect(isMaxFileSizeError(new Error("boom"))).toBe(false);
  });
});
