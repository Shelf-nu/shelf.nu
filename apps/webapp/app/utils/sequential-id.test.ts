import { describe, expect, it } from "vitest";

import {
  isSequentialId,
  normalizeSequentialId,
  parseSequentialId,
} from "~/utils/sequential-id";

describe("sequential-id utilities", () => {
  it("normalizes sequential ids by trimming and uppercasing", () => {
    expect(normalizeSequentialId("  sam-0005 \n")).toBe("SAM-0005");
  });

  it("validates sequential ids that match the expected format", () => {
    expect(isSequentialId("SAM-0001")).toBe(true);
    expect(isSequentialId("sam-1234")).toBe(true);
  });

  it("rejects invalid sequential id values", () => {
    expect(isSequentialId("SAM-12")).toBe(false);
    expect(isSequentialId("sam-ABCD" as unknown as string)).toBe(false);
    expect(isSequentialId("QR1234")).toBe(false);
    expect(isSequentialId(undefined as unknown as string)).toBe(false);
  });

  it("parses sequential ids and returns the normalized value", () => {
    expect(parseSequentialId("sam-9876")).toBe("SAM-9876");
  });

  it("returns null when parsing invalid sequential ids", () => {
    expect(parseSequentialId("invalid")).toBeNull();
    expect(parseSequentialId(undefined)).toBeNull();
  });
});
