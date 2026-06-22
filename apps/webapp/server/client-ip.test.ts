import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getClientIp } from "./client-ip";

// @vitest-environment node

/**
 * Resolves `getClientIp` for a single request carrying the given headers, by
 * running it inside a throwaway Hono handler (the only way to obtain a real
 * `Context`).
 */
async function resolve(headers: Record<string, string>): Promise<string> {
  const app = new Hono();
  let captured = "";
  app.get("/", (c) => {
    captured = getClientIp(c);
    return c.text("ok");
  });
  await app.request("/", { headers });
  return captured;
}

describe("getClientIp", () => {
  afterEach(() => {
    // why: tests below mutate NODE_ENV via stubEnv; restore between cases.
    vi.unstubAllEnvs();
  });

  it("prefers Fly-Client-IP and ignores X-Forwarded-For when present", async () => {
    const ip = await resolve({
      "Fly-Client-IP": "203.0.113.7",
      "X-Forwarded-For": "1.2.3.4",
    });
    expect(ip).toBe("203.0.113.7");
  });

  it("does NOT trust X-Forwarded-For in production (returns unknown)", async () => {
    // why: production must never bucket on a spoofable client-supplied header.
    vi.stubEnv("NODE_ENV", "production");
    const ip = await resolve({ "X-Forwarded-For": "9.9.9.9, 10.0.0.5" });
    expect(ip).toBe("unknown");
  });

  it("falls back to the leftmost X-Forwarded-For outside production", async () => {
    // why: local dev has no Fly edge, so the dev fallback must still resolve.
    vi.stubEnv("NODE_ENV", "development");
    const ip = await resolve({ "X-Forwarded-For": "9.9.9.9, 10.0.0.5" });
    expect(ip).toBe("9.9.9.9");
  });

  it("returns 'unknown' when no usable header is present", async () => {
    const ip = await resolve({});
    expect(ip).toBe("unknown");
  });
});
