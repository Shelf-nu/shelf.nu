/**
 * SSO sign-in with PKCE: what Shelf sends Supabase Auth when a sign-in starts,
 * and when a callback code is traded for a session.
 *
 * Supabase Auth is answered by MSW at its HTTP boundary, so the real client
 * library runs: these tests pin the wire format (a S256 challenge that matches
 * the verifier handed back, the verifier presented at the exchange) and how
 * each Supabase answer reaches the person.
 *
 * @see {@link file://./sso-pkce.server.ts}
 */
// @vitest-environment node
import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "@mocks";
import { SUPABASE_URL } from "@mocks/handlers";
import {
  exchangeSsoCode,
  isCodeVerifier,
  readTokenAccount,
  startSsoSignIn,
} from "./sso-pkce.server";

/** A well-formed verifier, as `startSsoSignIn` would hand back. */
const VERIFIER = "v".repeat(56);

/** The session Supabase Auth returns for a successful exchange. */
const supabaseSession = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: "bearer",
  user: { id: "auth-user-1", email: "jane@acme.com" },
};

/** S256 as RFC 7636 defines it: base64url(SHA-256(verifier)). */
function s256(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Answers `POST /auth/v1/sso` and records the body Shelf sent.
 *
 * @returns The recorded bodies
 */
function answerSsoStart() {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(`${SUPABASE_URL}/auth/v1/sso`, async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ url: "https://idp.example.com/saml" });
    })
  );
  return bodies;
}

/**
 * Answers the PKCE token exchange and records what Shelf presented.
 *
 * @param response - What Supabase Auth answers
 * @returns The recorded bodies
 */
function answerExchange(response: Response) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.post(`${SUPABASE_URL}/auth/v1/token`, async ({ request }) => {
      expect(new URL(request.url).searchParams.get("grant_type")).toBe("pkce");
      bodies.push((await request.json()) as Record<string, unknown>);
      return response;
    })
  );
  return bodies;
}

describe("startSsoSignIn", () => {
  it("asks for a code with a S256 challenge of the verifier it hands back", async () => {
    const bodies = answerSsoStart();

    const { url, codeVerifier } = await startSsoSignIn("acme.com");

    expect(url).toBe("https://idp.example.com/saml");
    expect(isCodeVerifier(codeVerifier)).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      domain: "acme.com",
      redirect_to: "http://localhost:3000/oauth/callback",
      code_challenge: s256(codeVerifier),
      code_challenge_method: "s256",
    });
  });

  it("lands a mobile sign-in on the native-app callback", async () => {
    const bodies = answerSsoStart();

    await startSsoSignIn("acme.com", { platform: "mobile" });

    expect(bodies[0]).toMatchObject({
      redirect_to: "http://localhost:3000/oauth/callback/mobile",
    });
  });

  it("starts every sign-in with a fresh verifier", async () => {
    answerSsoStart();

    const first = await startSsoSignIn("acme.com");
    const second = await startSsoSignIn("acme.com");

    expect(first.codeVerifier).not.toBe(second.codeVerifier);
  });

  it("tells the person when the domain has no SSO provider", async () => {
    server.use(
      http.post(`${SUPABASE_URL}/auth/v1/sso`, () =>
        HttpResponse.json(
          { code: 404, error_code: "sso_provider_not_found", msg: "Not found" },
          { status: 404 }
        )
      )
    );

    await expect(startSsoSignIn("acme.com")).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      message: "No SSO provider assigned for your organization's domain",
    });
  });
});

describe("exchangeSsoCode", () => {
  it("presents the code with this browser's verifier and returns the session", async () => {
    const bodies = answerExchange(HttpResponse.json(supabaseSession));

    const session = await exchangeSsoCode({
      code: "auth-code",
      codeVerifier: VERIFIER,
    });

    expect(bodies).toEqual([
      { auth_code: "auth-code", code_verifier: VERIFIER },
    ]);
    expect(session).toMatchObject({
      userId: "auth-user-1",
      email: "jane@acme.com",
      accessToken: "access",
      refreshToken: "refresh",
    });
  });

  it.each([
    ["no verifier cookie", undefined],
    ["an empty cookie", ""],
    ["a malformed cookie", "short"],
  ])("refuses with %s before asking Supabase", async (_case, codeVerifier) => {
    const bodies = answerExchange(HttpResponse.json(supabaseSession));

    await expect(
      exchangeSsoCode({ code: "auth-code", codeVerifier })
    ).rejects.toMatchObject({ status: 400, shouldBeCaptured: false });
    expect(bodies).toHaveLength(0);
  });

  it("asks the person to start again when Supabase refuses the pair", async () => {
    answerExchange(
      HttpResponse.json(
        { code: 400, error_code: "bad_code_verifier", msg: "Bad verifier" },
        { status: 400 }
      )
    );

    await expect(
      exchangeSsoCode({ code: "auth-code", codeVerifier: VERIFIER })
    ).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
      title: "Sign-in expired",
    });
  });

  it("treats a rate limit as a failure to retry, not an expired sign-in", async () => {
    answerExchange(
      HttpResponse.json(
        { code: 429, error_code: "over_request_rate_limit", msg: "Slow down" },
        { status: 429 }
      )
    );

    await expect(
      exchangeSsoCode({ code: "auth-code", codeVerifier: VERIFIER })
    ).rejects.toMatchObject({ status: 500, shouldBeCaptured: true });
  });

  it("reports a Supabase outage as a captured failure", async () => {
    answerExchange(HttpResponse.json({}, { status: 503 }));

    await expect(
      exchangeSsoCode({ code: "auth-code", codeVerifier: VERIFIER })
    ).rejects.toMatchObject({ status: 500, shouldBeCaptured: true });
  });
});

describe("readTokenAccount", () => {
  it("returns the account Supabase reports for the token", async () => {
    server.use(
      http.get(`${SUPABASE_URL}/auth/v1/user`, ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer tile-token");
        return HttpResponse.json({ id: "auth-user-1", email: "jane@acme.com" });
      })
    );

    await expect(readTokenAccount("tile-token")).resolves.toEqual({
      userId: "auth-user-1",
      email: "jane@acme.com",
    });
  });

  it("refuses a token whose account has no email", async () => {
    server.use(
      http.get(`${SUPABASE_URL}/auth/v1/user`, () =>
        HttpResponse.json({ id: "auth-user-1" })
      )
    );

    await expect(readTokenAccount("tile-token")).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
    });
  });

  it("refuses a token Supabase does not accept", async () => {
    server.use(
      http.get(`${SUPABASE_URL}/auth/v1/user`, () =>
        HttpResponse.json(
          { code: 403, error_code: "bad_jwt", msg: "invalid JWT" },
          { status: 403 }
        )
      )
    );

    await expect(readTokenAccount("forged")).rejects.toMatchObject({
      status: 400,
      shouldBeCaptured: false,
    });
  });
});
