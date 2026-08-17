/**
 * Sentry tunnel destination pinning.
 *
 * The tunnel used to build its upstream URL from the DSN in the CLIENT's
 * envelope, which made the destination host fully attacker-controlled — a
 * full-read SSRF (detail.dev finding D071). These tests pin the replacement
 * contract: the envelope's DSN is only ever COMPARED against the server's own
 * configuration, never used to build a URL.
 *
 * @see {@link file://./sentry-tunnel.server.ts}
 * @see {@link file://./../routes/api+/sentry-tunnel.ts}
 */

import { describe, expect, it } from "vitest";

import {
  buildSentryEnvelopeUrl,
  envelopeDsnMatches,
  parseSentryDsn,
} from "./sentry-tunnel.server";

// @vitest-environment node

const TARGET = {
  origin: "https://o123.ingest.sentry.io",
  pathPrefix: "",
  projectId: "456",
};

describe("parseSentryDsn", () => {
  it("pulls the ingest origin and project id out of a real DSN", () => {
    expect(parseSentryDsn("https://pubkey@o123.ingest.sentry.io/456")).toEqual(
      TARGET
    );
  });

  it("keeps the base path a self-hosted instance is mounted under", () => {
    // The old code used `pathname.replace("/", "")`, which strips only the
    // FIRST slash and produced "some/path/456" as the project id. Taking the
    // last segment fixes that, but the prefix still has to be KEPT — the
    // ingest endpoint lives under it.
    expect(
      parseSentryDsn("https://pubkey@sentry.example.com/some/path/456")
    ).toEqual({
      origin: "https://sentry.example.com",
      pathPrefix: "/some/path",
      projectId: "456",
    });
  });

  it("keeps a non-default port, which `hostname` would drop", () => {
    expect(
      parseSentryDsn("https://pubkey@sentry.example.com:8443/456")
    ).toEqual({
      origin: "https://sentry.example.com:8443",
      pathPrefix: "",
      projectId: "456",
    });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty (Sentry not configured)", ""],
    ["not a URL", "not-a-dsn"],
    ["no project id", "https://pubkey@o123.ingest.sentry.io/"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["a javascript: URL", "javascript:alert(1)"],
    // The tunnel always egressed over https, so an http DSN never worked.
    // Refusing it keeps the parser and `buildSentryEnvelopeUrl` in agreement.
    ["a plaintext http DSN", "http://pubkey@o123.ingest.sentry.io/456"],
  ])("returns null for %s", (_label, input) => {
    expect(parseSentryDsn(input)).toBeNull();
  });
});

describe("envelopeDsnMatches", () => {
  it("accepts the envelope the real SDK sends", () => {
    expect(
      envelopeDsnMatches("https://pubkey@o123.ingest.sentry.io/456", TARGET)
    ).toBe(true);
  });

  it("ignores the public key, which rotates and is not a security boundary", () => {
    expect(
      envelopeDsnMatches("https://different@o123.ingest.sentry.io/456", TARGET)
    ).toBe(true);
  });

  it("is case-insensitive on the host, as DNS is", () => {
    expect(
      envelopeDsnMatches("https://pubkey@O123.INGEST.SENTRY.IO/456", TARGET)
    ).toBe(true);
  });

  it("rejects a different project on the same host", () => {
    // Otherwise the tunnel is a free relay into any Sentry org.
    expect(
      envelopeDsnMatches("https://pubkey@o123.ingest.sentry.io/999", TARGET)
    ).toBe(false);
  });

  it.each([
    ["an arbitrary attacker host", "https://evil.com/456"],
    ["the AWS metadata endpoint", "https://169.254.169.254/456"],
    ["localhost", "https://127.0.0.1/456"],
    [
      "a host that merely ends with ours",
      "https://evilo123.ingest.sentry.io/456",
    ],
    [
      "a host that merely contains ours",
      "https://o123.ingest.sentry.io.evil.com/456",
    ],
    [
      "ours smuggled into userinfo",
      "https://o123.ingest.sentry.io@evil.com/456",
    ],
    [
      "ours smuggled into the path",
      "https://evil.com/o123.ingest.sentry.io/456",
    ],
  ])("rejects %s", (_label, dsn) => {
    expect(envelopeDsnMatches(dsn, TARGET)).toBe(false);
  });

  it("rejects garbage rather than throwing", () => {
    expect(envelopeDsnMatches("", TARGET)).toBe(false);
    expect(envelopeDsnMatches("not-a-dsn", TARGET)).toBe(false);
  });
});

describe("buildSentryEnvelopeUrl", () => {
  it("builds the endpoint for a root-mounted instance", () => {
    expect(buildSentryEnvelopeUrl(TARGET)).toBe(
      "https://o123.ingest.sentry.io/api/456/envelope/"
    );
  });

  it("builds the endpoint for a prefixed instance on a non-default port", () => {
    // Both halves were previously lost: `hostname` dropped :8443, and the
    // prefix was discarded — forwarding to a URL that does not exist there.
    const target = parseSentryDsn(
      "https://pubkey@sentry.example.com:8443/sentry/456"
    );

    expect(target).not.toBeNull();
    expect(buildSentryEnvelopeUrl(target!)).toBe(
      "https://sentry.example.com:8443/sentry/api/456/envelope/"
    );
  });

  it("always emits https, because the parser refuses anything else", () => {
    expect(buildSentryEnvelopeUrl(TARGET).startsWith("https://")).toBe(true);
  });
});
