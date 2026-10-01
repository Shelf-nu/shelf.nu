/**
 * Route tests for how the mobile SSO callback action reports a login that
 * moved the account onto SSO.
 *
 * When an SSO login is merged onto an existing account, the session Supabase
 * issued belongs to a deleted duplicate. No code may be minted for it: the
 * user signs in once more, so the action reports a success notice, not an
 * error.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback_.mobile.tsx
 * @see apps/webapp/app/utils/sso.server.ts resolveUserAndOrgForSsoCallback
 */
import { assertIsDataWithResponseInit } from "@helpers/assertions";
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";

// why: importing the route pulls the Prisma client transitively; the action's
// database work is behind the mocked services below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: pin the SSO kill-switch so the assertions do not depend on DISABLE_SSO
// in the local environment.
vi.mock("~/config/shelf.config", () => ({
  config: { disableSSO: false },
}));

// why: refreshAccessToken exchanges the refresh token with Supabase.
vi.mock("~/modules/auth/service.server", () => ({
  refreshAccessToken: vi.fn(),
}));

// why: the resolver provisions users and merges auth accounts, covered by
// sso.server.test.ts. The real isSsoAccountLinkedError stays, because which
// errors the route treats as a notice is what these tests pin.
vi.mock("~/utils/sso.server", async () => ({
  ...(await vi.importActual<typeof import("~/utils/sso.server")>(
    "~/utils/sso.server"
  )),
  resolveUserAndOrgForSsoCallback: vi.fn(),
}));

// why: the code is persisted in the database; here only whether one is
// minted matters (its hashing and PKCE binding are covered by
// mobile-sso.server.test.ts).
vi.mock("~/modules/auth/mobile-sso.server", () => ({
  createMobileAuthCode: vi.fn(),
}));

const { action } = await import("~/routes/_auth+/oauth.callback_.mobile");
const { refreshAccessToken } = await import("~/modules/auth/service.server");
const { resolveUserAndOrgForSsoCallback } = await import("~/utils/sso.server");
const { createMobileAuthCode } = await import(
  "~/modules/auth/mobile-sso.server"
);

/** The session Supabase issued for this login. */
const callbackSession = {
  userId: "duplicate-sso-auth-user",
  email: "jane@acme.com",
  accessToken: "callback-access",
  refreshToken: "callback-refresh",
  expiresIn: 3600,
  expiresAt: 0,
};

/** Posts the callback form and runs the action. */
function postCallback() {
  const request = new Request("http://localhost/oauth/callback/mobile", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      firstName: "Jane",
      lastName: "Doe",
      refreshToken: "client-refresh-token",
    }),
  });
  return action(createActionArgs({ request }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refreshAccessToken).mockResolvedValue(callbackSession);
  vi.mocked(createMobileAuthCode).mockResolvedValue("plain-code");
});

describe("POST /oauth/callback/mobile", () => {
  it("reports a linked account as a success notice and mints no code", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 409,
        message:
          "Your account is now on single sign-on. Sign in again to continue.",
        additionalData: { ssoAccountLinked: true },
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    const result = await postCallback();

    expect(createMobileAuthCode).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status ?? 200).toBe(200);
    expect(result.data).toEqual({
      error: null,
      ssoAccountLinked: true,
      message:
        "Your account is now on single sign-on. Sign in again to continue.",
    });
    // The one-shot PKCE challenge is cleared on this exit too.
    expect(new Headers(result.init?.headers).get("set-cookie")).toContain(
      "mobile_pkce_challenge="
    );
  });

  it("still reports other resolver failures as errors", async () => {
    vi.mocked(resolveUserAndOrgForSsoCallback).mockRejectedValue(
      new ShelfError({
        cause: null,
        status: 409,
        message: "More than one Shelf account uses this email address.",
        label: "Auth",
        shouldBeCaptured: false,
      })
    );

    const result = await postCallback();

    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(409);
    expect(result.data).toEqual({
      error: {
        message: "More than one Shelf account uses this email address.",
      },
    });
  });
});
