/**
 * Tests for the URL a Shelf QR code encodes, with and without a URL shortener
 * configured.
 *
 * @see {@link file://./qr-url.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ URL_SHORTENER: "" as string }));

// why: URL_SHORTENER is read from the process environment once at import;
// a getter lets each test choose whether a shortener is configured.
vi.mock("~/utils/env", async (importActual) => ({
  ...(await importActual<Record<string, unknown>>()),
  get URL_SHORTENER() {
    return env.URL_SHORTENER;
  },
}));

import { getQrBaseUrl, getQrUrl } from "./qr-url.server";

describe("getQrUrl", () => {
  beforeEach(() => {
    env.URL_SHORTENER = "";
  });

  it("uses the shortener when one is configured", () => {
    env.URL_SHORTENER = "eam.sh";

    expect(getQrBaseUrl()).toBe("https://eam.sh");
    expect(getQrUrl("cm4abc123")).toBe("https://eam.sh/cm4abc123");
  });

  it("falls back to this server's /qr route without a shortener", () => {
    expect(getQrBaseUrl()).toBe("http://localhost:3000/qr");
    expect(getQrUrl("cm4abc123")).toBe("http://localhost:3000/qr/cm4abc123");
  });

  it("is empty when there is no code", () => {
    env.URL_SHORTENER = "eam.sh";

    expect(getQrUrl(null)).toBe("");
    expect(getQrUrl(undefined)).toBe("");
    expect(getQrUrl("")).toBe("");
  });
});
