/**
 * Sentry tunnel route — SSRF regression coverage.
 *
 * The tunnel built its upstream URL from the DSN inside the client's own
 * envelope, so the destination host was fully attacker-controlled and the
 * upstream body was handed straight back: a full-read SSRF (detail.dev
 * finding D071).
 *
 * The exploit chain needed only a public host the attacker controls — it
 * answered the request with a redirect to `http://169.254.169.254/...` and
 * `fetch` chased it, because the route set no `redirect` option. Verified
 * against real sockets before writing the fix: the redirect was followed to a
 * different host and the internal body came back to the caller.
 *
 * These tests assert on the URL actually passed to `fetch`, because that is
 * the sink. A test that only checked the response status would pass even if
 * the request still went to the attacker's host.
 *
 * @see {@link file://./../../../app/routes/api+/sentry-tunnel.ts}
 * @see {@link file://./../../../app/utils/sentry-tunnel.server.ts}
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// why: the route reads the deployment's own DSN from the env module, which
// reads `process.env` at import time. Pinning it here is what makes "the
// configured project" a fixed, assertable value.
vi.mock("~/utils/env", () => ({
  SENTRY_DSN: "https://pubkey@o123.ingest.sentry.io/456",
}));

import { action } from "~/routes/api+/sentry-tunnel";

// @vitest-environment node

const CONFIGURED_URL = "https://o123.ingest.sentry.io/api/456/envelope/";

/** Builds a Sentry envelope whose header declares `dsn`. */
function envelope(dsn: string) {
  return `${JSON.stringify({
    dsn,
    sent_at: "2026-01-01T00:00:00.000Z",
  })}\n{"type":"event"}\n{}`;
}

/** Invokes the route action with a raw envelope body. */
function post(body: string) {
  return action({
    request: new Request("https://app.shelf.nu/api/sentry-tunnel", {
      method: "POST",
      body,
    }),
    params: {},
    context: {},
  } as unknown as Parameters<typeof action>[0]);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response('{"id":"abc"}', {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sentry-tunnel action", () => {
  it("forwards a genuine envelope to the configured project", () => {
    return post(envelope("https://pubkey@o123.ingest.sentry.io/456")).then(
      async (response) => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(CONFIGURED_URL);
        expect(response.status).toBe(200);
      }
    );
  });

  it("never follows redirects", () => {
    // Redirect-following was half the exploit: a public host the attacker
    // controls answers with a 302 to an internal address.
    return post(envelope("https://pubkey@o123.ingest.sentry.io/456")).then(
      () => {
        expect(fetchMock.mock.calls[0][1]).toMatchObject({
          redirect: "manual",
        });
      }
    );
  });

  it.each([
    ["an attacker-controlled host", "https://pubkey@evil.com/456"],
    ["the AWS metadata endpoint", "https://pubkey@169.254.169.254/456"],
    ["localhost", "https://pubkey@127.0.0.1/456"],
    ["a suffix look-alike", "https://pubkey@evil-o123.ingest.sentry.io/456"],
    [
      "a subdomain look-alike",
      "https://pubkey@o123.ingest.sentry.io.evil.com/456",
    ],
    [
      "our host hidden in userinfo",
      "https://o123.ingest.sentry.io@evil.com/456",
    ],
  ])("refuses %s without making any request", (_label, dsn) => {
    return post(envelope(dsn)).then((response) => {
      expect(response.status).toBe(403);
      // The assertion that matters: the sink was never reached.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("refuses a different Sentry project on our own host", () => {
    return post(envelope("https://pubkey@o123.ingest.sentry.io/999")).then(
      (response) => {
        expect(response.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    );
  });

  it("does not echo the rejected DSN back to the caller", () => {
    return post(envelope("https://pubkey@evil.com/456")).then(
      async (response) => {
        expect(await response.text()).not.toContain("evil.com");
      }
    );
  });

  it("rejects an envelope with no DSN", () => {
    return post(envelope("")).then((response) => {
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects a malformed envelope header", () => {
    return post("not json\n{}").then((response) => {
      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
