// @vitest-environment node
// why: a browser-shaped `Request` (happy-dom) drops the forbidden `Cookie`
// header; the server runtime that reads this cookie does not.

/**
 * Signup intent cookie codec: what a request must carry for the intent to be
 * trusted on the way back in.
 *
 * @see {@link file://./cookie.server.ts}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIGNUP_INTENT_TTL_SECONDS,
  clearSignupIntentHeaders,
  readSignupIntent,
  refreshSignupIntentHeaders,
  serializeClearedSignupIntent,
  serializeSignupIntent,
  signupIntentHeaders,
} from "./cookie.server";
import type { SignupIntent } from "./schema";

const INTENT: SignupIntent = {
  plan: "team",
  trial: true,
  redirectTo: "/qr/abc",
  utmSource: "website",
  utmMedium: "pricing",
  utmCampaign: "launch",
  utmContent: "hero",
};

/** A request carrying the given `Set-Cookie` value back as its `Cookie`. */
function requestWithCookie(setCookieValue: string | null) {
  const headers = new Headers();
  if (setCookieValue !== null) {
    // Only the `name=value` pair travels back; the attributes stay behind.
    headers.set("Cookie", setCookieValue.split(";")[0]);
  }
  return new Request("http://localhost:3000/otp", { headers });
}

describe("signup intent cookie", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips an intent", async () => {
    const setCookie = await serializeSignupIntent(INTENT);

    await expect(
      readSignupIntent(requestWithCookie(setCookie))
    ).resolves.toEqual(INTENT);
  });

  it("is HttpOnly, path-wide and short-lived", async () => {
    const setCookie = await serializeSignupIntent(INTENT);

    expect(setCookie).toMatch(/^signup-intent=/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain(`Max-Age=${SIGNUP_INTENT_TTL_SECONDS}`);
  });

  it("reads no intent from a request without the cookie", async () => {
    await expect(readSignupIntent(requestWithCookie(null))).resolves.toBeNull();
  });

  it("rejects a value whose signature no longer matches", async () => {
    const setCookie = await serializeSignupIntent(INTENT);
    // The value is `<base64 payload>.<signature>`; edit the payload and keep
    // the signature, as someone trying to promote their own intent would.
    const [pair] = setCookie.split(";");
    const [name, value] = pair.split("=");
    const [payload, signature] = value.split(".");
    const flipped = payload[0] === "A" ? "B" : "A";
    const tampered = `${name}=${flipped}${payload.slice(1)}.${signature}`;

    const request = new Request("http://localhost:3000/otp", {
      headers: { Cookie: tampered },
    });

    await expect(readSignupIntent(request)).resolves.toBeNull();
  });

  it("rejects an unsigned value", async () => {
    const request = new Request("http://localhost:3000/otp", {
      headers: {
        Cookie: `signup-intent=${btoa(
          JSON.stringify({ ...INTENT, expiresAt: Date.now() + 60_000 })
        )}`,
      },
    });

    await expect(readSignupIntent(request)).resolves.toBeNull();
  });

  it("ignores a value past its window even when the browser still sends it", async () => {
    const setCookie = await serializeSignupIntent(INTENT);

    vi.setSystemTime(
      new Date("2026-09-16T12:00:00Z").getTime() +
        SIGNUP_INTENT_TTL_SECONDS * 1000 +
        1
    );

    await expect(
      readSignupIntent(requestWithCookie(setCookie))
    ).resolves.toBeNull();
  });

  it("still trusts a value inside its window", async () => {
    const setCookie = await serializeSignupIntent(INTENT);

    vi.setSystemTime(
      new Date("2026-09-16T12:00:00Z").getTime() +
        SIGNUP_INTENT_TTL_SECONDS * 1000 -
        1000
    );

    await expect(
      readSignupIntent(requestWithCookie(setCookie))
    ).resolves.toEqual(INTENT);
  });

  it("re-issuing restarts the window", async () => {
    const first = await serializeSignupIntent(INTENT);

    // Twenty minutes later the flow re-issues the cookie…
    vi.setSystemTime(new Date("2026-09-16T12:20:00Z"));
    const [[headerName, refreshed]] = await refreshSignupIntentHeaders(
      requestWithCookie(first)
    );
    expect(headerName).toBe("Set-Cookie");

    // …so twenty minutes after that the original is stale but the re-issued
    // value is still good.
    vi.setSystemTime(new Date("2026-09-16T12:40:00Z"));
    await expect(
      readSignupIntent(requestWithCookie(first))
    ).resolves.toBeNull();
    await expect(
      readSignupIntent(requestWithCookie(refreshed))
    ).resolves.toEqual(INTENT);
  });

  it("emits no headers when there is nothing to carry", async () => {
    await expect(signupIntentHeaders(null)).resolves.toEqual([]);
    await expect(
      refreshSignupIntentHeaders(requestWithCookie(null))
    ).resolves.toEqual([]);
  });

  it("clears the cookie with an expired Set-Cookie", async () => {
    const cleared = await serializeClearedSignupIntent();
    expect(cleared).toMatch(/^signup-intent=/);
    expect(cleared).toContain("Max-Age=0");

    const [[headerName, value]] = await clearSignupIntentHeaders();
    expect(headerName).toBe("Set-Cookie");
    expect(value).toContain("Max-Age=0");
  });
});
