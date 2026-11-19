/**
 * Which key the SSO PKCE client authenticates with, and when it tells Supabase
 * Auth the visitor's IP. Supabase counts PKCE grants in the same per-IP token
 * limit as password sign-ins and reads `Sb-Forwarded-For` only on secret-key
 * requests, so SSO forwards the IP exactly when a secret key is configured.
 *
 * Supabase Auth is answered by MSW at its HTTP boundary, so the real client
 * library builds the requests.
 *
 * @see {@link file://./sso-pkce.server.ts}
 */
// @vitest-environment node
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "@mocks";
import { SUPABASE_URL } from "@mocks/handlers";
import type * as Env from "~/utils/env";
import { exchangeSsoCode, startSsoSignIn } from "./sso-pkce.server";

const keys = vi.hoisted(() => ({
  SUPABASE_SECRET_KEY: undefined as string | undefined,
}));

// why: the configured keys are read from the environment at import; each case
// picks whether an operator has set a secret key.
vi.mock("~/utils/env", async (importOriginal) => ({
  ...(await importOriginal<typeof Env>()),
  SUPABASE_URL: (await import("@mocks/handlers")).SUPABASE_URL,
  SUPABASE_ANON_PUBLIC: "anon-key",
  get SUPABASE_SECRET_KEY() {
    return keys.SUPABASE_SECRET_KEY;
  },
}));

/** A well-formed verifier, as `startSsoSignIn` would hand back. */
const VERIFIER = "v".repeat(56);
const VISITOR_IP = "203.0.113.7";

/**
 * Answers Supabase's SSO start and PKCE exchange and records the headers Shelf
 * sent to each.
 */
function recordHeaders() {
  const seen: { start: Headers[]; exchange: Headers[] } = {
    start: [],
    exchange: [],
  };
  server.use(
    http.post(`${SUPABASE_URL}/auth/v1/sso`, ({ request }) => {
      seen.start.push(request.headers);
      return HttpResponse.json({ url: "https://idp.example.com/saml" });
    }),
    http.post(`${SUPABASE_URL}/auth/v1/token`, ({ request }) => {
      seen.exchange.push(request.headers);
      return HttpResponse.json({
        access_token: "access",
        refresh_token: "refresh",
        expires_in: 3600,
        expires_at: 1_900_000_000,
        token_type: "bearer",
        user: { id: "auth-user-1", email: "jane@example.com" },
      });
    })
  );
  return seen;
}

afterEach(() => {
  keys.SUPABASE_SECRET_KEY = undefined;
});

describe("SSO sign-in and the visitor IP", () => {
  it("uses the secret key and forwards the visitor IP when a secret key is set", async () => {
    keys.SUPABASE_SECRET_KEY = "sb_secret_test";
    const seen = recordHeaders();

    await startSsoSignIn("example.com", { clientIp: VISITOR_IP });
    await exchangeSsoCode({
      code: "auth-code",
      codeVerifier: VERIFIER,
      clientIp: VISITOR_IP,
    });

    for (const headers of [seen.start[0], seen.exchange[0]]) {
      expect(headers.get("apikey")).toBe("sb_secret_test");
      expect(headers.get("sb-forwarded-for")).toBe(VISITOR_IP);
    }
  });

  it("keeps the anon key and sends no IP without a secret key", async () => {
    const seen = recordHeaders();

    await startSsoSignIn("example.com", { clientIp: VISITOR_IP });
    await exchangeSsoCode({
      code: "auth-code",
      codeVerifier: VERIFIER,
      clientIp: VISITOR_IP,
    });

    for (const headers of [seen.start[0], seen.exchange[0]]) {
      expect(headers.get("apikey")).toBe("anon-key");
      expect(headers.get("sb-forwarded-for")).toBeNull();
    }
  });

  it("sends no IP when the visitor's IP is unknown", async () => {
    keys.SUPABASE_SECRET_KEY = "sb_secret_test";
    const seen = recordHeaders();

    await exchangeSsoCode({
      code: "auth-code",
      codeVerifier: VERIFIER,
      clientIp: null,
    });

    expect(seen.exchange[0].get("sb-forwarded-for")).toBeNull();
  });
});
