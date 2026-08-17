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

import { envelopeDsnMatches, parseSentryDsn } from "./sentry-tunnel.server";

// @vitest-environment node

const TARGET = { host: "o123.ingest.sentry.io", projectId: "456" };

describe("parseSentryDsn", () => {
  it("pulls the ingest host and project id out of a real DSN", () => {
    expect(parseSentryDsn("https://pubkey@o123.ingest.sentry.io/456")).toEqual(
      TARGET
    );
  });

  it("takes the LAST path segment as the project id", () => {
    // A self-hosted Sentry can live under a path prefix. The old code used
    // `pathname.replace("/", "")`, which strips only the FIRST slash and would
    // have produced "some/path/456".
    expect(
      parseSentryDsn("https://pubkey@sentry.example.com/some/path/456")
    ).toEqual({ host: "sentry.example.com", projectId: "456" });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty (Sentry not configured)", ""],
    ["not a URL", "not-a-dsn"],
    ["no project id", "https://pubkey@o123.ingest.sentry.io/"],
    ["a non-http scheme", "file:///etc/passwd"],
    ["a javascript: URL", "javascript:alert(1)"],
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
