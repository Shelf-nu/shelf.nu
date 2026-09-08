/**
 * Unit tests for {@link generateClientId}.
 *
 * The helper must return a canonical version 4 UUID on every path: the native
 * `crypto.randomUUID`, the `getRandomValues` fallback (older browsers and
 * plain-HTTP origins, where `randomUUID` is undefined), and the `Math.random`
 * fallback when no `crypto` object exists at all.
 *
 * @see {@link file://./client-id.ts}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateClientId } from "./client-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("generateClientId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID when the runtime provides it", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: vi.fn() });

    expect(generateClientId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("builds a v4 UUID from getRandomValues when randomUUID is missing", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      for (let i = 0; i < bytes.length; i++) bytes[i] = 0xff;
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });

    const id = generateClientId();

    expect(id).toMatch(UUID_V4);
    expect(getRandomValues).toHaveBeenCalledOnce();
    // Version and variant bits are forced even on all-ones input.
    expect(id).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
  });

  it("still returns a v4 UUID without any crypto object", () => {
    vi.stubGlobal("crypto", undefined);

    expect(generateClientId()).toMatch(UUID_V4);
  });

  it("returns distinct ids on consecutive calls", () => {
    vi.stubGlobal("crypto", undefined);

    const ids = new Set(Array.from({ length: 50 }, () => generateClientId()));

    expect(ids.size).toBe(50);
  });
});
