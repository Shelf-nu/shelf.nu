// @vitest-environment node
/**
 * Which address counts as the visitor's, for every way a request can reach the
 * server. A wrong answer either throttles strangers together (the edge address)
 * or lets a caller choose their own rate-limit key (a forged header).
 *
 * @see {@link file://./client-ip.server.ts}
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getClientIpFromHeaders, isCloudflareEdgeIp } from "./client-ip.server";

/** An address inside Cloudflare's published 104.16.0.0/13 range. */
const CLOUDFLARE_V4 = "104.16.1.1";
/** An address inside Cloudflare's published 2606:4700::/32 range. */
const CLOUDFLARE_V6 = "2606:4700::6810:1";
const VISITOR = "203.0.113.7";

afterEach(() => {
  // why: each case picks Fly or self-hosted through FLY_APP_NAME.
  vi.unstubAllEnvs();
});

describe("isCloudflareEdgeIp", () => {
  it.each([CLOUDFLARE_V4, CLOUDFLARE_V6, "172.64.0.1", "2a06:98c7::1"])(
    "knows %s is Cloudflare",
    (ip) => expect(isCloudflareEdgeIp(ip)).toBe(true)
  );

  it.each([VISITOR, "1.1.1.1", "2001:db8::1"])(
    "knows %s is not Cloudflare",
    (ip) => expect(isCloudflareEdgeIp(ip)).toBe(false)
  );
});

describe("getClientIpFromHeaders on Fly", () => {
  it("uses CF-Connecting-IP when the request came through Cloudflare", () => {
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": VISITOR,
    });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("does the same for Cloudflare's IPv6 edge", () => {
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V6,
      "CF-Connecting-IP": "2001:db8::42",
    });
    expect(getClientIpFromHeaders(headers)).toBe("2001:db8::42");
  });

  it("ignores CF-Connecting-IP from a caller that skipped Cloudflare", () => {
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
    const headers = new Headers({
      "Fly-Client-IP": VISITOR,
      "CF-Connecting-IP": "198.51.100.99",
    });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("keeps the Cloudflare address when CF-Connecting-IP is missing or not an IP", () => {
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
    expect(
      getClientIpFromHeaders(new Headers({ "Fly-Client-IP": CLOUDFLARE_V4 }))
    ).toBe(CLOUDFLARE_V4);
    expect(
      getClientIpFromHeaders(
        new Headers({
          "Fly-Client-IP": CLOUDFLARE_V4,
          "CF-Connecting-IP": "not-an-ip",
        })
      )
    ).toBe(CLOUDFLARE_V4);
  });

  it("never reads X-Forwarded-For", () => {
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
    expect(
      getClientIpFromHeaders(new Headers({ "X-Forwarded-For": VISITOR }))
    ).toBeNull();
  });
});

describe("getClientIpFromHeaders self-hosted", () => {
  it("uses the leftmost X-Forwarded-For", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    const headers = new Headers({ "X-Forwarded-For": `${VISITOR}, 10.0.0.5` });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("ignores Fly-Client-IP and CF-Connecting-IP, which any caller can send", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": "198.51.100.99",
    });
    expect(getClientIpFromHeaders(headers)).toBeNull();
  });

  it("returns null for a value that is not an IP address", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    const headers = new Headers({ "X-Forwarded-For": "<script>, 10.0.0.5" });
    expect(getClientIpFromHeaders(headers)).toBeNull();
  });
});
