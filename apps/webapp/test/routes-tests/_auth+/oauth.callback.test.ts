/**
 * Route tests for how the web SSO callback action reports a login that moved
 * the account onto SSO.
 *
 * When an SSO login is merged onto an existing account, the session Supabase
 * issued belongs to a deleted duplicate and must not be issued. The user signs
 * in once more, so the action reports a success notice, not an error, and sets
 * no session.
 *
 * @see apps/webapp/app/routes/_auth+/oauth.callback.tsx
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

const { action } = await import("~/routes/_auth+/oauth.callback");
const { refreshAccessToken } = await import("~/modules/auth/service.server");
const { resolveUserAndOrgForSsoCallback } = await import("~/utils/sso.server");

/** The session Supabase issued for this login. */
const callbackSession = {
  userId: "duplicate-sso-auth-user",
  email: "jane@acme.com",
  accessToken: "callback-access",
  refreshToken: "callback-refresh",
  expiresIn: 3600,
  expiresAt: 0,
};

/** Posts the callback form and runs the action with a session spy. */
async function postCallback() {
  const setSession = vi.fn();
  const request = new Request("http://localhost/oauth/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      firstName: "Jane",
      lastName: "Doe",
      refreshToken: "client-refresh-token",
      redirectTo: "/assets",
    }),
  });
  const result = await action(
    createActionArgs({ request, context: { setSession } as never })
  );
  return { result, setSession };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refreshAccessToken).mockResolvedValue(callbackSession);
});

describe("POST /oauth/callback", () => {
  it("reports a linked account as a success notice and issues no session", async () => {
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

    const { result, setSession } = await postCallback();

    expect(setSession).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    // A notice, not a failure: no error payload and no error status.
    expect(result.init?.status ?? 200).toBe(200);
    expect(result.data).toEqual({
      error: null,
      ssoAccountLinked: true,
      message:
        "Your account is now on single sign-on. Sign in again to continue.",
    });
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

    const { result, setSession } = await postCallback();

    expect(setSession).not.toHaveBeenCalled();
    assertIsDataWithResponseInit(result);
    expect(result.init?.status).toBe(409);
    expect(result.data).toMatchObject({
      error: {
        message: "More than one Shelf account uses this email address.",
      },
    });
    expect(result.data).not.toHaveProperty("ssoAccountLinked");
  });
});
