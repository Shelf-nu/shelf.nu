// @vitest-environment node
/**
 * Which address counts as the visitor's, for every way a request can reach the
 * server. A wrong answer either throttles strangers together (the edge address)
 * or lets a caller choose their own rate-limit key (a forged header).
 *
 * @see {@link file://./client-ip.server.ts}
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getClientIpFromHeaders,
  isCloudflareEdgeIp,
  PROXY_SECRET_HEADER,
} from "./client-ip.server";
import { UNLOGGED_HEADERS } from "./logger";

/** An address inside Cloudflare's published 104.16.0.0/13 range. */
const CLOUDFLARE_V4 = "104.16.1.1";
/** An address inside Cloudflare's published 2606:4700::/32 range. */
const CLOUDFLARE_V6 = "2606:4700::6810:1";
const VISITOR = "203.0.113.7";
const PROXY_SECRET = "zone-transform-rule-secret";

/** Fly-side setup: on Fly, with Shelf's Cloudflare zone secret configured. */
function onFlyBehindOwnZone() {
  vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
  vi.stubEnv("CLOUDFLARE_PROXY_SECRET", PROXY_SECRET);
}

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
  it("uses CF-Connecting-IP when the request came through Shelf's Cloudflare zone", () => {
    onFlyBehindOwnZone();
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": VISITOR,
      [PROXY_SECRET_HEADER]: PROXY_SECRET,
    });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("does the same for Cloudflare's IPv6 edge", () => {
    onFlyBehindOwnZone();
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V6,
      "CF-Connecting-IP": "2001:db8::42",
      [PROXY_SECRET_HEADER]: PROXY_SECRET,
    });
    expect(getClientIpFromHeaders(headers)).toBe("2001:db8::42");
  });

  it("ignores CF-Connecting-IP from someone else's Cloudflare zone or Worker", () => {
    onFlyBehindOwnZone();
    const forged = {
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": "198.51.100.99",
    };
    expect(getClientIpFromHeaders(new Headers(forged))).toBe(CLOUDFLARE_V4);
    expect(
      getClientIpFromHeaders(
        new Headers({ ...forged, [PROXY_SECRET_HEADER]: "a-guess" })
      )
    ).toBe(CLOUDFLARE_V4);
  });

  it("ignores CF-Connecting-IP when no zone secret is configured", () => {
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": VISITOR,
      [PROXY_SECRET_HEADER]: "",
    });
    expect(getClientIpFromHeaders(headers)).toBe(CLOUDFLARE_V4);
  });

  it("ignores CF-Connecting-IP from a caller that skipped Cloudflare", () => {
    onFlyBehindOwnZone();
    const headers = new Headers({
      "Fly-Client-IP": VISITOR,
      "CF-Connecting-IP": "198.51.100.99",
      [PROXY_SECRET_HEADER]: PROXY_SECRET,
    });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("keeps the Cloudflare address when CF-Connecting-IP is not an IP", () => {
    onFlyBehindOwnZone();
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": "not-an-ip",
      [PROXY_SECRET_HEADER]: PROXY_SECRET,
    });
    expect(getClientIpFromHeaders(headers)).toBe(CLOUDFLARE_V4);
  });

  it("never reads X-Forwarded-For", () => {
    onFlyBehindOwnZone();
    expect(
      getClientIpFromHeaders(new Headers({ "X-Forwarded-For": VISITOR }))
    ).toBeNull();
  });
});

describe("getClientIpFromHeaders self-hosted", () => {
  it("knows nothing without TRUSTED_PROXY_HOPS, because the client writes X-Forwarded-For", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    const headers = new Headers({ "X-Forwarded-For": `${VISITOR}, 10.0.0.5` });
    expect(getClientIpFromHeaders(headers)).toBeNull();
  });

  it("with one trusted proxy, takes the entry that proxy appended, not a forged one", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const headers = new Headers({
      "X-Forwarded-For": `198.51.100.99, ${VISITOR}`,
    });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("with two trusted proxies, skips the inner proxy's entry", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    const headers = new Headers({
      "X-Forwarded-For": `198.51.100.99, ${VISITOR}, 10.0.0.5`,
    });
    expect(getClientIpFromHeaders(headers)).toBe(VISITOR);
  });

  it("returns null when the header has fewer entries than trusted proxies", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(
      getClientIpFromHeaders(new Headers({ "X-Forwarded-For": VISITOR }))
    ).toBeNull();
  });

  it("ignores Fly-Client-IP and CF-Connecting-IP, which any caller can send", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const headers = new Headers({
      "Fly-Client-IP": CLOUDFLARE_V4,
      "CF-Connecting-IP": "198.51.100.99",
    });
    expect(getClientIpFromHeaders(headers)).toBeNull();
  });

  it("returns null for a value that is not an IP address", () => {
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    const headers = new Headers({ "X-Forwarded-For": "10.0.0.5, <script>" });
    expect(getClientIpFromHeaders(headers)).toBeNull();
  });
});

describe("the proxy secret header", () => {
  it("is never written to logs or Sentry", () => {
    expect(UNLOGGED_HEADERS).toContain(PROXY_SECRET_HEADER);
  });
});
