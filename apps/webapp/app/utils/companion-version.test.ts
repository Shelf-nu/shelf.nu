import { describe, expect, it } from "vitest";
import { readCompanionVersion } from "./companion-version";

describe("readCompanionVersion", () => {
  it("treats an unset value as no version", () => {
    expect(readCompanionVersion(undefined)).toEqual({
      version: null,
      invalid: false,
    });
    expect(readCompanionVersion("  ")).toEqual({
      version: null,
      invalid: false,
    });
  });

  it("accepts and trims a version the app can read", () => {
    expect(readCompanionVersion(" 1.6.0 ")).toEqual({
      version: "1.6.0",
      invalid: false,
    });
    expect(readCompanionVersion("2")).toEqual({ version: "2", invalid: false });
    expect(readCompanionVersion("1.6.0-beta.1")).toEqual({
      version: "1.6.0-beta.1",
      invalid: false,
    });
  });

  it("rejects a value the app would ignore", () => {
    for (const value of ["v1.6.0", "1.6.x", "latest", "1..6"]) {
      expect(readCompanionVersion(value)).toEqual({
        version: null,
        invalid: true,
      });
    }
  });
});
