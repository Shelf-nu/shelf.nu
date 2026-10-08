/**
 * Splitting an advanced-filter URL parameter into its operator and value.
 *
 * The grammar is `operator:value`, and the VALUE is user data that may itself
 * contain colons — Code128, DataMatrix and ExternalQR all permit them, and a
 * URL custom field is mostly colon. Only the first colon separates; every one
 * after it belongs to the value.
 *
 * @see {@link file://./filter-param.ts}
 */
import { describe, expect, it } from "vitest";

import { splitFilterParam } from "./filter-param";

describe("splitFilterParam", () => {
  it("splits an ordinary operator and value", () => {
    expect(splitFilterParam("is:AVAILABLE")).toEqual(["is", "AVAILABLE"]);
  });

  it("keeps colons that belong to the value", () => {
    // Splitting on every colon and taking the second field silently truncates
    // to "ABC", which then matches nothing — or, at the validation layer,
    // rejects the parameter outright and drops the filter from the URL.
    expect(splitFilterParam("is:ABC:123")).toEqual(["is", "ABC:123"]);
  });

  it("keeps a URL intact", () => {
    expect(splitFilterParam("is:https://example.com/a:b")).toEqual([
      "is",
      "https://example.com/a:b",
    ]);
  });

  it("reports a missing value as undefined rather than empty", () => {
    // A parameter with no colon has no value at all, which is different from
    // one whose value is the empty string — the callers gate on it.
    expect(splitFilterParam("is")).toEqual(["is", undefined]);
  });

  it("treats a trailing colon as an empty value, not a missing one", () => {
    expect(splitFilterParam("is:")).toEqual(["is", ""]);
  });

  it("does not mistake a leading colon for an operator", () => {
    expect(splitFilterParam(":AVAILABLE")).toEqual(["", "AVAILABLE"]);
  });

  it("preserves a value that is only colons", () => {
    expect(splitFilterParam("is:::")).toEqual(["is", "::"]);
  });
});
