/**
 * Tests for the companion-app server registry resolver.
 *
 * The resolver is deliberately fail-open — a missing or malformed registry must
 * resolve to `null` ("use Shelf Cloud") rather than throw, because it sits on
 * the login path for every companion user, cloud ones included.
 *
 * @see ./companion-servers.server.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the resolver reads a module-scope env export. Mocking the env module
// with a getter is the only way to vary the registry per test without mutating
// process.env, which would leak across the suite.
const mockEnv = { COMPANION_SERVERS: "" };
vi.mock("~/utils/env", () => ({
  get COMPANION_SERVERS() {
    return mockEnv.COMPANION_SERVERS;
  },
}));

const { resolveCompanionServer } = await import("./companion-servers.server");

describe("resolveCompanionServer", () => {
  beforeEach(() => {
    mockEnv.COMPANION_SERVERS = JSON.stringify({
      "acme.edu": "https://acme.i.shelf.nu",
      "acme.com": "https://acme.i.shelf.nu/",
    });
  });

  it("resolves a known domain", () => {
    expect(resolveCompanionServer("acme.edu")).toBe("https://acme.i.shelf.nu");
  });

  it("matches case-insensitively", () => {
    expect(resolveCompanionServer("ACME.edu")).toBe("https://acme.i.shelf.nu");
  });

  it("ignores surrounding whitespace", () => {
    expect(resolveCompanionServer("  acme.edu  ")).toBe(
      "https://acme.i.shelf.nu"
    );
  });

  it("strips a trailing slash from the configured URL", () => {
    expect(resolveCompanionServer("acme.com")).toBe("https://acme.i.shelf.nu");
  });

  it("returns null for an unknown domain", () => {
    expect(resolveCompanionServer("unknown.org")).toBeNull();
  });

  it("returns null when the registry is unset", () => {
    mockEnv.COMPANION_SERVERS = "";
    expect(resolveCompanionServer("acme.edu")).toBeNull();
  });

  it("returns null rather than throwing on malformed JSON", () => {
    mockEnv.COMPANION_SERVERS = "{not json";
    expect(resolveCompanionServer("acme.edu")).toBeNull();
  });

  it("returns null when the registry is a JSON array", () => {
    mockEnv.COMPANION_SERVERS = JSON.stringify(["acme.edu"]);
    expect(resolveCompanionServer("acme.edu")).toBeNull();
  });

  it("ignores non-https entries", () => {
    mockEnv.COMPANION_SERVERS = JSON.stringify({
      "acme.edu": "http://acme.i.shelf.nu",
    });
    expect(resolveCompanionServer("acme.edu")).toBeNull();
  });

  it("ignores non-string values", () => {
    mockEnv.COMPANION_SERVERS = JSON.stringify({ "acme.edu": 42 });
    expect(resolveCompanionServer("acme.edu")).toBeNull();
  });

  it("keeps valid entries when a sibling entry is invalid", () => {
    mockEnv.COMPANION_SERVERS = JSON.stringify({
      "bad.edu": "http://insecure.example.com",
      "good.edu": "https://good.i.shelf.nu",
    });
    expect(resolveCompanionServer("bad.edu")).toBeNull();
    expect(resolveCompanionServer("good.edu")).toBe("https://good.i.shelf.nu");
  });
});
