/**
 * Tests for the build version helpers.
 *
 * @see {@link file://./build-version.ts}
 */
import { describe, expect, it } from "vitest";
import {
  compareBuildIds,
  DEV_BUILD_ID,
  getOwnBuildId,
  isChunkLoadError,
  parseBuildVersionResponse,
} from "./build-version";

describe("compareBuildIds", () => {
  it("reads a later server id as newer", () => {
    expect(compareBuildIds("1700000000000", "1700000000001")).toBe("newer");
  });

  it("reads an equal server id as the same build", () => {
    expect(compareBuildIds("1700000000000", "1700000000000")).toBe("same");
  });

  it("reads an earlier server id as older", () => {
    expect(compareBuildIds("1700000000001", "1700000000000")).toBe("older");
  });

  it("compares numerically, not as text", () => {
    expect(compareBuildIds("9", "10")).toBe("newer");
  });

  it("cannot compare a dev build on either side", () => {
    expect(compareBuildIds(DEV_BUILD_ID, "1700000000000")).toBe("unknown");
    expect(compareBuildIds("1700000000000", DEV_BUILD_ID)).toBe("unknown");
  });

  it("cannot compare ids that are not digit strings", () => {
    expect(compareBuildIds("1700000000000", "abc123")).toBe("unknown");
    expect(compareBuildIds("1700000000000", "")).toBe("unknown");
    expect(compareBuildIds("1.5", "2")).toBe("unknown");
    expect(compareBuildIds("-1", "2")).toBe("unknown");
  });
});

describe("getOwnBuildId", () => {
  it("returns the id injected for the test run", () => {
    expect(getOwnBuildId()).toBe("test");
  });
});

describe("parseBuildVersionResponse", () => {
  it("returns the build id from a well-formed body", () => {
    expect(parseBuildVersionResponse({ buildId: "1700000000000" })).toBe(
      "1700000000000"
    );
  });

  it("returns null for an empty or non-string id", () => {
    expect(parseBuildVersionResponse({ buildId: "" })).toBeNull();
    expect(parseBuildVersionResponse({ buildId: 1700000000000 })).toBeNull();
    expect(parseBuildVersionResponse({})).toBeNull();
  });

  it("returns null for bodies that are not objects", () => {
    expect(parseBuildVersionResponse(null)).toBeNull();
    expect(parseBuildVersionResponse("1700000000000")).toBeNull();
    expect(parseBuildVersionResponse(undefined)).toBeNull();
  });
});

describe("isChunkLoadError", () => {
  it.each([
    [
      "Chrome",
      "Failed to fetch dynamically imported module: https://app/file-assets/x/a.js",
    ],
    ["Safari", "Importing a module script failed."],
    [
      "Firefox",
      "error loading dynamically imported module: https://app/file-assets/x/a.js",
    ],
    ["Vite", "Unable to preload CSS for /file-assets/x/a.css"],
    ["generic chunk", "Loading chunk 42 failed."],
    ["ChunkLoadError name in message", "ChunkLoadError: chunk failed"],
  ])("recognises the %s message", (_source, message) => {
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it("matches regardless of case", () => {
    expect(
      isChunkLoadError(
        new TypeError("FAILED TO FETCH DYNAMICALLY IMPORTED MODULE")
      )
    ).toBe(true);
  });

  it("accepts any value with a string message", () => {
    expect(
      isChunkLoadError({ message: "Importing a module script failed." })
    ).toBe(true);
  });

  it("ignores an ordinary render error", () => {
    expect(
      isChunkLoadError(
        new TypeError("Cannot read properties of undefined (reading 'id')")
      )
    ).toBe(false);
  });

  it("ignores values without a string message", () => {
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError("Loading chunk 1 failed")).toBe(false);
    expect(isChunkLoadError({ message: 42 })).toBe(false);
  });
});
