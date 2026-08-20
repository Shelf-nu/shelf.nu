// @vitest-environment node
/**
 * Credentials embedded in URL VALUES must not reach the logs.
 *
 * `redactSensitive` matches on key names, so `{ url: "..." }` passed straight
 * through — the key is just `url`, and the secret is inside the value.
 *
 * That is reachable, not theoretical: asset CSV import accepts arbitrary image
 * URLs, and `ssrf.server.ts` puts the URL into `additionalData` on every
 * failure path. A row pointing at a basic-auth or signed URL therefore wrote a
 * live credential to the platform logs (CWE-532).
 *
 * detail.dev finding D110.
 *
 * @see {@link file://./redact.ts}
 * @see {@link file://./ssrf.server.ts}
 */
import { describe, expect, it } from "vitest";

import { redactSensitive, redactUrlCredentials } from "./redact";

describe("redactUrlCredentials", () => {
  it("strips basic-auth userinfo", () => {
    const out = redactUrlCredentials(
      "https://alice:hunter2@example.com/img.jpg"
    );

    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("alice");
    // The rest of the URL survives — the point is a usable log line, not a
    // blanked one.
    expect(out).toContain("example.com/img.jpg");
  });

  it.each([
    "token",
    "access_token",
    "api_key",
    "signature",
    "X-Amz-Signature",
    "X-Amz-Security-Token",
  ])("redacts the %s query parameter", (param) => {
    const out = redactUrlCredentials(
      `https://bucket.example.com/img.jpg?${param}=s3cr3t-value&w=200`
    );

    expect(out).not.toContain("s3cr3t-value");
    // Non-sensitive params are untouched, so the URL stays diagnosable.
    expect(out).toContain("w=200");
  });

  it("leaves an ordinary URL alone", () => {
    const url = "https://example.com/img.jpg?w=200&h=100";
    expect(redactUrlCredentials(url)).toBe(url);
  });

  it("returns a clean URL BYTE-for-byte, without normalizing it", () => {
    // The previous version returned `url.toString()` unconditionally, so a
    // URL with nothing to redact still came back rewritten:
    // `HTTPS://EXAMPLE.COM:443/a` -> `https://example.com/a`. The earlier test
    // above missed it by picking a URL that was already normalized.
    //
    // A redactor that quietly edits non-secrets is its own debugging problem —
    // the log line no longer matches what the user submitted.
    const url = "HTTPS://EXAMPLE.COM:443/a?B=2&a=1";
    expect(redactUrlCredentials(url)).toBe(url);
  });

  it.each(["X-Goog-Signature", "X-Goog-Credential"])(
    "redacts the Google Cloud %s parameter",
    (param) => {
      // Signed URLs come in both AWS (`X-Amz-*`) and Google (`X-Goog-*`)
      // spellings; an imported image URL can point at either bucket.
      const out = redactUrlCredentials(
        `https://storage.googleapis.com/b/o.jpg?${param}=deadbeefsig`
      );

      expect(out).not.toContain("deadbeefsig");
    }
  );

  it("leaves non-URL strings alone", () => {
    // Runs over every string in every error payload, so it must not mangle
    // ordinary prose.
    const prose = "Failed to fetch image: connection reset by peer";
    expect(redactUrlCredentials(prose)).toBe(prose);
  });

  it("strips the password from an UNPARSEABLE url", () => {
    // The case that matters most in practice: a malformed URL is precisely the
    // one that gets logged, because being malformed is why the import failed.
    const out = redactUrlCredentials("https://alice:hunter2@");

    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("alice");
  });

  it("leaves an unparseable url with no credentials alone", () => {
    const broken = "https://";
    expect(redactUrlCredentials(broken)).toBe(broken);
  });
});

describe("redactSensitive — URL values", () => {
  it("redacts a credential under a NON-sensitive key", () => {
    // The whole point: `url` is not a sensitive key name, so key-based
    // redaction could never have caught this.
    const out = redactSensitive({
      url: "https://user:pw@host/img.jpg?token=abc123",
      status: 403,
    });

    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("pw@");
    expect(serialized).not.toContain("abc123");
    expect(out.status).toBe(403);
  });

  it("reaches URLs nested inside additionalData", () => {
    const out = redactSensitive({
      additionalData: { url: "https://host/i.jpg?signature=deadbeef" },
    });

    expect(JSON.stringify(out)).not.toContain("deadbeef");
  });

  it("still redacts by key name", () => {
    // The pre-existing behaviour must survive the string branch being added.
    const out = redactSensitive({ password: "hunter2", email: "a@b.c" });

    expect(out.password).not.toBe("hunter2");
    expect(out.email).toBe("a@b.c");
  });
});
