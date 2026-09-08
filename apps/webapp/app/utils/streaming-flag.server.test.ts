// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { isStreamingEnabled } from "./streaming-flag.server";

describe("isStreamingEnabled", () => {
  const originalEnv = process.env.ADVANCED_INDEX_STREAMING_ORG_IDS;

  afterEach(() => {
    // Restore the original env var after each test
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = originalEnv;
  });

  it("returns false when env var is unset", () => {
    delete process.env.ADVANCED_INDEX_STREAMING_ORG_IDS;
    expect(isStreamingEnabled("org_a")).toBe(false);
  });

  it("returns false when env var is empty string", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "";
    expect(isStreamingEnabled("org_a")).toBe(false);
  });

  it("returns false when env var is whitespace-only", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "   ";
    expect(isStreamingEnabled("org_a")).toBe(false);
  });

  it("returns true for an org in a single-id list", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "org_a";
    expect(isStreamingEnabled("org_a")).toBe(true);
  });

  it("returns false for an org not in the list", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "org_a,org_b";
    expect(isStreamingEnabled("org_c")).toBe(false);
  });

  it("returns true for multiple orgs in a comma-separated list", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "org_a,org_b";
    expect(isStreamingEnabled("org_a")).toBe(true);
    expect(isStreamingEnabled("org_b")).toBe(true);
  });

  it("handles whitespace around ids (trim)", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = " org_a , org_b ";
    expect(isStreamingEnabled("org_a")).toBe(true);
    expect(isStreamingEnabled("org_b")).toBe(true);
    expect(isStreamingEnabled(" org_a")).toBe(false); // Exact match required
  });

  it("ignores empty entries after splitting", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "org_a,,org_b";
    expect(isStreamingEnabled("org_a")).toBe(true);
    expect(isStreamingEnabled("org_b")).toBe(true);
  });

  it("performs exact-match comparison (case-sensitive)", () => {
    process.env.ADVANCED_INDEX_STREAMING_ORG_IDS = "org_a";
    expect(isStreamingEnabled("org_a")).toBe(true);
    expect(isStreamingEnabled("ORG_A")).toBe(false);
    expect(isStreamingEnabled("Org_a")).toBe(false);
  });
});
