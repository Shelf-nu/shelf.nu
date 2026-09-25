import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, redactRequestTarget } from "./logger";

// @vitest-environment node

describe("redactRequestTarget", () => {
  it("redacts the calendar feed token and keeps the .ics extension", () => {
    expect(
      redactRequestTarget("/api/calendar/feed/f3edS3cr3tT0k3n.ics", "")
    ).toBe("/api/calendar/feed/REDACTED.ics");
  });

  it("redacts the calendar feed token when the extension is missing", () => {
    expect(redactRequestTarget("/api/calendar/feed/f3edS3cr3tT0k3n", "")).toBe(
      "/api/calendar/feed/REDACTED"
    );
  });

  it("redacts the invite token query parameter and keeps the invite id", () => {
    expect(
      redactRequestTarget("/accept-invite/inv_123", "?token=eyJhbGciOi.jwt.sig")
    ).toBe("/accept-invite/inv_123?token=REDACTED");
  });

  it.each(["token", "access_token", "refresh_token", "X-Amz-Signature"])(
    "redacts the %s query parameter and keeps the others",
    (name) => {
      expect(
        redactRequestTarget("/some/page", `?page=2&${name}=s3cr3t&sort=asc`)
      ).toBe(`/some/page?page=2&${name}=REDACTED&sort=asc`);
    }
  );

  it("returns a clean path and query exactly as received", () => {
    expect(redactRequestTarget("/assets", "?s=a%20b&page=2")).toBe(
      "/assets?s=a%20b&page=2"
    );
  });
});

describe("logger middleware", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never writes the calendar feed token to the request log", async () => {
    // why: the middleware's only output is console.log; spying on it is the
    // way to observe the log line it writes.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const app = new Hono();
    app.use("*", logger());
    app.get("*", (c) => c.text("ok"));

    await app.request("/api/calendar/feed/f3edS3cr3tT0k3n.ics");

    const lines = log.mock.calls.map((args) => args.join(" "));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain("/api/calendar/feed/REDACTED.ics");
      expect(line).not.toContain("f3edS3cr3tT0k3n");
    }
  });
});
