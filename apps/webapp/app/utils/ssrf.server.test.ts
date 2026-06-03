// @vitest-environment node
// why: exercises Node's undici-backed fetch/Response and the `dns`/`net`
// primitives; happy-dom would shadow Response and ignore the undici dispatcher.

import { describe, expect, it } from "vitest";

import {
  BlockedAddressError,
  isPrivateOrReservedIp,
  readBodyWithLimit,
  safeFetch,
  ssrfGuardedLookup,
} from "./ssrf.server";

// Classification is delegated to ipaddr.js with a strict default-deny policy:
// only globally-routable `unicast` is allowed; every other range it recognises
// is blocked. These tests lock in that policy across the ranges that matter for
// SSRF (and the transition ranges that can smuggle a private target).
describe("isPrivateOrReservedIp", () => {
  it.each([
    // Loopback / unspecified
    ["0.0.0.0"],
    ["127.0.0.1"],
    ["127.255.255.254"],
    // Private RFC1918
    ["10.0.0.1"],
    ["10.255.255.255"],
    ["172.16.0.1"],
    ["172.31.255.255"],
    ["192.168.0.1"],
    ["192.168.255.255"],
    // CGNAT
    ["100.64.0.1"],
    ["100.127.255.255"],
    // Link-local — cloud metadata lives at 169.254.169.254
    ["169.254.0.1"],
    ["169.254.169.254"],
    // Reserved / documentation
    ["192.0.2.10"],
    ["198.51.100.1"],
    ["203.0.113.1"],
    ["192.88.99.1"], // 6to4 relay anycast (reserved)
    ["224.0.0.1"], // multicast
    ["240.0.0.1"], // reserved
    ["255.255.255.255"], // broadcast
    // IPv6
    ["::1"], // loopback
    ["::"], // unspecified
    ["fc00::1"], // unique-local
    ["fd12:3456::1"], // unique-local
    ["fe80::1"], // link-local
    ["ff02::1"], // multicast
    // IPv6 transition ranges — blocked by the unicast-only default-deny policy
    // because they can encode an embedded/internal IPv4 target.
    ["2002:c0a8:0101::1"], // 6to4 wrapping 192.168.1.1
    ["2001:0:0:0:0:0:0:1"], // Teredo
    ["64:ff9b::a9fe:a9fe"], // NAT64 (rfc6052) wrapping 169.254.169.254
    // IPv4-mapped / NAT64 smuggling a private v4 target through a v6 literal
    ["::ffff:127.0.0.1"],
    ["::ffff:169.254.169.254"],
    ["::ffff:10.0.0.1"],
    ["64:ff9b::169.254.169.254"], // dotted NAT64 form — unparseable → fails closed
  ])("blocks %s", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(true);
  });

  it.each([
    ["1.1.1.1"],
    ["8.8.8.8"],
    ["140.82.121.4"], // github.com-ish
    ["203.0.114.1"], // just outside the 203.0.113.0/24 doc range
    ["192.0.1.1"], // outside 192.0.0.0/24 + 192.0.2.0/24
    ["198.51.99.1"], // outside 198.51.100.0/24
    ["2606:4700:4700::1111"], // cloudflare dns (global unicast)
    ["::ffff:8.8.8.8"], // mapped, but to a public v4
  ])("allows public address %s", (ip) => {
    expect(isPrivateOrReservedIp(ip)).toBe(false);
  });

  it("fails closed on non-IP input", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
    expect(isPrivateOrReservedIp("")).toBe(true);
  });
});

/**
 * Runs the guarded lookup against an IP *literal* (which `dns.lookup` resolves
 * offline, without any network query) and resolves with the outcome.
 */
function runGuardedLookup(
  host: string
): Promise<{ err: Error | null; address?: string }> {
  return new Promise((resolve) => {
    ssrfGuardedLookup(host, { all: false }, (err, address) => {
      resolve({ err: err as Error | null, address: address as string });
    });
  });
}

describe("ssrfGuardedLookup", () => {
  it.each([
    ["127.0.0.1"],
    ["169.254.169.254"],
    ["10.0.0.1"],
    ["::1"],
    ["::ffff:127.0.0.1"],
  ])("refuses to resolve blocked literal %s", async (host) => {
    const { err } = await runGuardedLookup(host);
    expect(err).toBeInstanceOf(BlockedAddressError);
  });

  it.each([["1.1.1.1"], ["8.8.8.8"]])(
    "permits public literal %s",
    async (host) => {
      const { err, address } = await runGuardedLookup(host);
      expect(err).toBeNull();
      expect(address).toBe(host);
    }
  );
});

describe("safeFetch input validation", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(safeFetch("file:///etc/passwd")).rejects.toThrow(
      /http and https/i
    );
    await expect(safeFetch("ftp://example.com/x")).rejects.toThrow(
      /http and https/i
    );
    await expect(safeFetch("gopher://example.com/x")).rejects.toThrow(
      /http and https/i
    );
  });

  it("rejects malformed URLs", async () => {
    await expect(safeFetch("not a url")).rejects.toThrow(/invalid url/i);
  });

  // NOTE: The end-to-end "connect is refused" guarantee is proven by the
  // `ssrfGuardedLookup` suite above — that lookup is exactly what the undici
  // dispatcher runs at connect time for every hop (initial + redirects). We
  // don't assert it through `safeFetch` here because the test harness's MSW
  // interceptor sits in front of the dispatcher and would shadow the guard.
});

/**
 * Builds a Response whose body streams `chunkCount` chunks of `chunkSize`
 * bytes, so the size cap can be exercised without any network.
 */
function streamingResponse(chunkSize: number, chunkCount: number): Response {
  let emitted = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emitted >= chunkCount) {
        controller.close();
        return;
      }
      emitted += 1;
      controller.enqueue(new Uint8Array(chunkSize));
    },
  });
  return new Response(stream);
}

describe("readBodyWithLimit", () => {
  it("returns the full body when within the limit", async () => {
    const res = streamingResponse(1000, 4); // 4000 bytes
    const buffer = await readBodyWithLimit(res, 8000, "http://x/test");
    expect(buffer.byteLength).toBe(4000);
  });

  it("aborts once the cumulative size exceeds the limit", async () => {
    const res = streamingResponse(1000, 100); // would be 100_000 bytes
    await expect(readBodyWithLimit(res, 5000, "http://x/test")).rejects.toThrow(
      /maximum allowed size/i
    );
  });
});
