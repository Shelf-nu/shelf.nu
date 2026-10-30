// @vitest-environment node
// why: exercises Node's undici-backed fetch/Response and the `dns`/`net`
// primitives; happy-dom would shadow Response and ignore the undici dispatcher.

/**
 * Unit tests for the SSRF protection utilities in `./ssrf.server`:
 * IP classification (`isPrivateOrReservedIp`), the guarded DNS lookup
 * (`ssrfGuardedLookup`), URL/IP-literal validation (`assertSafeUrl`), protocol
 * allowlisting and literal-host blocking in `safeFetch`, the streaming /
 * abortable body size cap in `readBodyWithLimit`, and the partial read,
 * headers and port rule of `safeFetchPrefix`.
 */

import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@mocks";

import {
  assertSafeUrl,
  BlockedAddressError,
  isPrivateOrReservedIp,
  readBodyWithLimit,
  safeFetch,
  safeFetchPrefix,
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

// `assertSafeUrl` is the synchronous gate `safeFetch` runs on the initial URL
// and on every redirect target. It closes the IP-literal bypass: undici's
// connector skips `connect.lookup` for hosts that are already IPs, so literal
// hosts must be classified here rather than relying on the guarded lookup.
describe("assertSafeUrl", () => {
  it.each([
    ["http://127.0.0.1/x.jpg"],
    ["http://169.254.169.254/latest/meta-data/iam/.jpg"], // cloud metadata
    ["http://10.0.0.1/internal"],
    ["http://192.168.1.1/"],
    ["https://[::1]/x"],
    ["http://[::ffff:127.0.0.1]/x"], // IPv4-mapped loopback
  ])("blocks private/reserved IP literal %s", (url) => {
    expect(() => assertSafeUrl(url)).toThrow(BlockedAddressError);
  });

  it.each([["file:///etc/passwd"], ["ftp://example.com/x"], ["gopher://h/x"]])(
    "rejects non-http(s) protocol %s",
    (url) => {
      expect(() => assertSafeUrl(url)).toThrow(/http and https/i);
    }
  );

  it("rejects malformed URLs", () => {
    expect(() => assertSafeUrl("not a url")).toThrow(/invalid url/i);
  });

  it("allows http(s) URLs with public hosts", () => {
    expect(assertSafeUrl("https://images.example.com/a.jpg").hostname).toBe(
      "images.example.com"
    );
    expect(assertSafeUrl("http://1.1.1.1/a.png").hostname).toBe("1.1.1.1");
  });
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

  // Regression guard for the IP-literal bypass (GHSA review, Codex P1): undici
  // does not route literal hosts through `connect.lookup`, so `safeFetch` must
  // reject them up front — before any socket is opened. These assertions run
  // entirely pre-`fetch`, so they are deterministic and MSW-independent.
  it.each([
    ["http://127.0.0.1/x.jpg"],
    ["http://169.254.169.254/latest/meta-data/iam/security-credentials/.jpg"],
    ["http://10.0.0.1/internal"],
    ["https://[::1]/x"],
  ])("blocks the IP-literal SSRF target %s", async (url) => {
    await expect(safeFetch(url)).rejects.toBeInstanceOf(BlockedAddressError);
  });

  // NOTE: The "connect is refused for a NAMED host" guarantee (and its
  // re-validation on each redirect hop) is proven by the `ssrfGuardedLookup`
  // suite above — that lookup is exactly what the undici dispatcher runs at
  // connect time. We can't assert it through `safeFetch` here because the test
  // harness's MSW interceptor sits in front of the dispatcher. Redirect targets
  // that are IP literals are covered because each hop is re-checked by
  // `assertSafeUrl` (tested directly above).
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

  it("aborts a slow/trickle body when the signal fires", async () => {
    // A body well under the size cap but read with an already-aborted signal
    // must be cut off — this is the slow-body DoS guard (hex/CodeRabbit review).
    const res = streamingResponse(10, 5); // 50 bytes, far below the cap
    const controller = new AbortController();
    controller.abort();
    await expect(
      readBodyWithLimit(res, 8000, "http://x/test", controller.signal)
    ).rejects.toThrow(/timed out/i);
  });
});

/** A streamed response body made of these text chunks, in order. */
function chunkedBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let next = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[next++]));
    },
  });
}

// why: MSW answers in place of the network, so these tests make no outbound
// request. It sits in front of the guarded dispatcher, so named-host blocking
// is proven by the `ssrfGuardedLookup` suite above, not here.
describe("safeFetchPrefix", () => {
  it("stops reading once </head> has arrived, even when it spans two chunks", async () => {
    server.use(
      http.get(
        "https://pages.example.com/manual",
        () =>
          new HttpResponse(
            chunkedBody([
              "<html><head><title>Manual</title></HE",
              "AD><body>",
              "x".repeat(10_000),
            ]),
            { headers: { "content-type": "text/html" } }
          )
      )
    );

    const result = await safeFetchPrefix("https://pages.example.com/manual", {
      maxBytes: 1_000_000,
      stopAfter: "</head>",
    });

    expect(result.status).toBe(200);
    expect(result.body.toString("utf8")).toBe(
      "<html><head><title>Manual</title></HEAD><body>"
    );
    expect(result.truncated).toBe(true);
  });

  it("cuts an oversized body at maxBytes instead of throwing", async () => {
    server.use(
      http.get(
        "https://pages.example.com/big",
        () =>
          new HttpResponse(chunkedBody(["a".repeat(3000), "b".repeat(3000)]))
      )
    );

    const result = await safeFetchPrefix("https://pages.example.com/big", {
      maxBytes: 4000,
    });

    expect(result.body.toString("utf8")).toBe(
      "a".repeat(3000) + "b".repeat(1000)
    );
    expect(result.truncated).toBe(true);
  });

  it("returns a body of exactly maxBytes whole and not truncated", async () => {
    server.use(
      http.get(
        "https://pages.example.com/exact",
        () =>
          new HttpResponse(chunkedBody(["a".repeat(2000), "b".repeat(2000)]))
      )
    );

    const result = await safeFetchPrefix("https://pages.example.com/exact", {
      maxBytes: 4000,
    });

    expect(result.body.byteLength).toBe(4000);
    expect(result.truncated).toBe(false);
  });

  it("returns an error status with its headers instead of throwing", async () => {
    server.use(
      http.get(
        "https://pages.example.com/challenge",
        () =>
          new HttpResponse("<html><head><title>Just a moment</title></head>", {
            status: 403,
            headers: { "cf-mitigated": "challenge" },
          })
      )
    );

    const result = await safeFetchPrefix(
      "https://pages.example.com/challenge",
      { maxBytes: 1000 }
    );

    expect(result.status).toBe(403);
    expect(result.headers.get("cf-mitigated")).toBe("challenge");
    expect(result.body.toString("utf8")).toBe(
      "<html><head><title>Just a moment</title></head>"
    );
  });

  it("sends the headers on every redirect hop and reports the final URL", async () => {
    const seen: Array<{ url: string; agent: string | null }> = [];
    server.use(
      http.get("https://short.example.com/m", ({ request }) => {
        seen.push({
          url: request.url,
          agent: request.headers.get("user-agent"),
        });
        return new HttpResponse(null, {
          status: 302,
          headers: { location: "https://pages.example.com/final" },
        });
      }),
      http.get("https://pages.example.com/final", ({ request }) => {
        seen.push({
          url: request.url,
          agent: request.headers.get("user-agent"),
        });
        return new HttpResponse("<title>Final</title>");
      })
    );

    const result = await safeFetchPrefix("https://short.example.com/m", {
      maxBytes: 1000,
      headers: { "user-agent": "ShelfTest/1.0" },
    });

    expect(seen).toEqual([
      { url: "https://short.example.com/m", agent: "ShelfTest/1.0" },
      { url: "https://pages.example.com/final", agent: "ShelfTest/1.0" },
    ]);
    expect(result.finalUrl.href).toBe("https://pages.example.com/final");
    expect(result.body.toString("utf8")).toBe("<title>Final</title>");
  });

  it("discards the body unread when readBodyIf declines it", async () => {
    server.use(
      http.get(
        "https://files.example.com/manual.pdf",
        () =>
          new HttpResponse(chunkedBody(["%PDF-1.7", "x".repeat(5000)]), {
            headers: { "content-type": "application/pdf" },
          })
      )
    );

    const result = await safeFetchPrefix(
      "https://files.example.com/manual.pdf",
      {
        maxBytes: 1000,
        readBodyIf: ({ headers }) =>
          headers.get("content-type") === "text/html",
      }
    );

    expect(result.status).toBe(200);
    expect(result.body.byteLength).toBe(0);
    expect(result.truncated).toBe(true);
  });

  it("refuses a non-default port, on the first URL and on a redirect hop", async () => {
    server.use(
      http.get(
        "https://short.example.com/to-port",
        () =>
          new HttpResponse(null, {
            status: 301,
            headers: { location: "https://pages.example.com:8443/admin" },
          })
      )
    );

    await expect(
      safeFetchPrefix("https://pages.example.com:6379/", { maxBytes: 1000 })
    ).rejects.toThrow("Refused to fetch from a non-default port");
    await expect(
      safeFetchPrefix("https://short.example.com/to-port", { maxBytes: 1000 })
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("allows a default port written out", async () => {
    server.use(
      http.get(
        "https://pages.example.com/explicit-port",
        () => new HttpResponse("ok")
      )
    );

    const result = await safeFetchPrefix(
      "https://pages.example.com:443/explicit-port",
      { maxBytes: 1000 }
    );

    expect(result.body.toString("utf8")).toBe("ok");
  });

  it("blocks a private address, on the first URL and on a redirect hop", async () => {
    server.use(
      http.get(
        "https://short.example.com/to-metadata",
        () =>
          new HttpResponse(null, {
            status: 302,
            headers: { location: "http://169.254.169.254/latest/meta-data/" },
          })
      )
    );

    await expect(
      safeFetchPrefix("http://127.0.0.1/", { maxBytes: 1000 })
    ).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(
      safeFetchPrefix("https://short.example.com/to-metadata", {
        maxBytes: 1000,
      })
    ).rejects.toBeInstanceOf(BlockedAddressError);
  });
});
