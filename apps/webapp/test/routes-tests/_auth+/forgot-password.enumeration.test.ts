// @vitest-environment node
/**
 * Forgot-password must not reveal whether an account exists.
 *
 * The invariant: every outcome responds identically (same status, same
 * redirect target) whether the address is registered, federated, or unknown.
 * A reset code is still sent only to a real, non-SSO account; the response
 * simply does not say which case occurred.
 *
 * The SSO domain decision (`getLegacyLoginDecision`) is asked inside
 * `sendResetPasswordLink`, which the route does not await, and a refusal there
 * sends nothing and resolves as a send does, so the response is unchanged too. The confirm step asks the same decision
 * once the code has verified, so a code sent before an address was refused
 * cannot set a password.
 *
 * detail.dev finding D100.
 *
 * @see {@link file://./../../../app/routes/_auth+/forgot-password.tsx}
 */

const { mockSendResetPasswordLink } = vi.hoisted(() => ({
  mockSendResetPasswordLink: vi.fn().mockResolvedValue(undefined),
}));
// why: sendResetPasswordLink sends a real email and is the sink these tests
// assert on; updateAccountPassword writes to Supabase Auth. The real
// refuseAuthenticatedLegacySession and revokeSession stay, because which
// failures end the recovery session is what the confirm tests pin.
vi.mock("~/modules/auth/service.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/modules/auth/service.server")>()),
  sendResetPasswordLink: mockSendResetPasswordLink,
  updateAccountPassword: vi.fn(),
  signInWithEmail: vi.fn(),
}));

const { mockGetLegacyLoginDecision } = vi.hoisted(() => ({
  mockGetLegacyLoginDecision: vi.fn(),
}));
// why: the decision has its own tests (sso-enforcement.server.test.ts); here
// only what the confirm step does with its answer matters.
vi.mock("~/modules/auth/sso-enforcement.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("~/modules/auth/sso-enforcement.server")
    >();
  return {
    createSsoRequiredError: actual.createSsoRequiredError,
    getLegacyLoginDecision: mockGetLegacyLoginDecision,
  };
});

const { mockVerifyOtp, mockSignOut } = vi.hoisted(() => ({
  mockVerifyOtp: vi.fn(),
  mockSignOut: vi.fn(),
}));
// why: the confirm step verifies the recovery code with Supabase Auth and ends
// the recovery session it opened on refusal; both are network calls.
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: () => ({
    auth: { verifyOtp: mockVerifyOtp, admin: { signOut: mockSignOut } },
  }),
}));

const { mockUserFindFirst } = vi.hoisted(() => ({
  mockUserFindFirst: vi.fn(),
}));
// why: chooses whether the account exists — the entire variable under test.
vi.mock("~/database/db.server", () => ({
  db: { user: { findFirst: mockUserFindFirst } },
}));

import { updateAccountPassword } from "~/modules/auth/service.server";
import { action } from "~/routes/_auth+/forgot-password";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/** POSTs a password-reset request for `email`. */
function requestReset(email: string) {
  return action({
    request: new Request("https://app.shelf.nu/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ intent: "request-otp", email }).toString(),
    }),
    params: {},
    context: {},
  } as unknown as Parameters<typeof action>[0]);
}

/** Reduces a response to what an attacker can actually observe. */
function observable(res: unknown) {
  // The action returns two different shapes: a `Response` for the redirect,
  // and React Router's `DataWithResponseInit` (`{ type, data, init }`) for the
  // error path. Reading only `.status` would report `undefined` for the latter
  // and quietly compare two `undefined`s, so both are normalized here.
  const r = res as Response & {
    init?: ResponseInit;
    data?: { error?: { message?: string } };
  };

  return {
    status: r.status ?? r.init?.status ?? null,
    location: r.headers?.get?.("Location") ?? null,
    errorMessage: r.data?.error?.message ?? null,
  };
}

describe("forgot-password enumeration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("responds IDENTICALLY for a registered and an unregistered address", async () => {
    mockUserFindFirst.mockResolvedValueOnce({ id: "user-1", sso: false });
    const registered = observable(await requestReset("real@example.com"));

    mockUserFindFirst.mockResolvedValueOnce(null);
    const unknown = observable(await requestReset("real@example.com"));

    // Same email in both, so the redirect target cannot differ for any reason
    // other than the account's existence — which is the leak.
    expect(unknown).toEqual(registered);
  });

  it("responds identically for an SSO account as for a normal one", async () => {
    // `user.sso` is per-user, so answering it confirmed the account existed.
    mockUserFindFirst.mockResolvedValueOnce({ id: "user-1", sso: false });
    const normal = observable(await requestReset("x@example.com"));

    mockUserFindFirst.mockResolvedValueOnce({ id: "user-2", sso: true });
    const ssoAccount = observable(await requestReset("x@example.com"));

    expect(ssoAccount).toEqual(normal);
  });

  it("still sends the link for a real non-SSO account", async () => {
    mockUserFindFirst.mockResolvedValue({ id: "user-1", sso: false });

    await requestReset("real@example.com");

    expect(mockSendResetPasswordLink).toHaveBeenCalledWith("real@example.com");
  });

  it("sends NOTHING for an unknown address", async () => {
    mockUserFindFirst.mockResolvedValue(null);

    await requestReset("nobody@example.com");

    expect(mockSendResetPasswordLink).not.toHaveBeenCalled();
  });

  it("sends NOTHING for an SSO account", async () => {
    mockUserFindFirst.mockResolvedValue({ id: "user-1", sso: true });

    await requestReset("sso@example.com");

    expect(mockSendResetPasswordLink).not.toHaveBeenCalled();
  });

  it("does not WAIT for the reset email to be sent", async () => {
    // Delivery must not block the response: response time cannot be allowed
    // to depend on whether the address exists, or repeated requests read the
    // answer off the clock.
    //
    // The unsettled promise is the assertion — if the action awaited delivery,
    // this test could never return.
    mockUserFindFirst.mockResolvedValue({ id: "user-1", sso: false });
    mockSendResetPasswordLink.mockImplementation(() => new Promise(() => {}));

    const res = observable(await requestReset("real@example.com"));

    expect(mockSendResetPasswordLink).toHaveBeenCalledWith("real@example.com");
    expect(res.status).toBe(302);
  });

  it("percent-encodes the address it echoes into the redirect", async () => {
    // `+` is valid in an email (gmail-style aliases) and is also the query
    // string's encoding for a space — so unencoded, `a+b@example.com` comes
    // back out of the URL as `a b@example.com`.
    mockUserFindFirst.mockResolvedValue(null);

    const res = observable(await requestReset("a+b@example.com"));

    expect(res.location).toContain("a%2Bb%40example.com");
  });

  it("responds identically when DELIVERY fails", async () => {
    // A rejected delivery must leave the response identical to an unknown
    // address. Delivery is only attempted for an address that exists and is
    // not SSO, so any response that differs on failure states exactly what the
    // uniform response withholds.
    mockUserFindFirst.mockResolvedValueOnce({ id: "user-1", sso: false });
    // The `.catch()` on the non-blocking call is what keeps a rejection here
    // from surfacing as an unhandled rejection.
    mockSendResetPasswordLink.mockRejectedValueOnce(new Error("smtp down"));
    const failed = observable(await requestReset("real@example.com"));

    mockUserFindFirst.mockResolvedValueOnce(null);
    const unknown = observable(await requestReset("real@example.com"));

    expect(failed).toEqual(unknown);
  });

  it("hands a password account on an SSO domain to the send step, which decides", async () => {
    // The domain decision costs a different number of queries per answer, so
    // it runs inside the un-awaited send rather than before the response.
    mockUserFindFirst.mockResolvedValue({ id: "legacy-1", sso: false });

    await requestReset("old-timer@sso-corp.com");

    expect(mockSendResetPasswordLink).toHaveBeenCalledWith(
      "old-timer@sso-corp.com"
    );
    expect(mockGetLegacyLoginDecision).not.toHaveBeenCalled();
  });

  it("responds identically, and logs nothing, when the send step refuses an SSO address", async () => {
    const loggerSpy = vi.spyOn(Logger, "error").mockImplementation(() => {});

    mockUserFindFirst.mockResolvedValueOnce({ id: "legacy-1", sso: false });
    // A refusal sends nothing and resolves exactly as a send does.
    mockSendResetPasswordLink.mockResolvedValueOnce(undefined);
    const refused = observable(await requestReset("member@sso-corp.com"));

    mockUserFindFirst.mockResolvedValueOnce(null);
    const unknown = observable(await requestReset("member@sso-corp.com"));

    // Let the un-awaited rejection settle before checking the log.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refused).toEqual(unknown);
    expect(loggerSpy).not.toHaveBeenCalled();
    loggerSpy.mockRestore();
  });
});

/** POSTs the confirm step: the recovery code plus the new password. */
function confirmReset(email: string, destroySession = vi.fn()) {
  return action({
    request: new Request("https://app.shelf.nu/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        intent: "confirm-otp",
        email,
        otp: "123456",
        password: "new-password-1",
        confirmPassword: "new-password-1",
      }).toString(),
    }),
    params: {},
    context: { destroySession },
  } as unknown as Parameters<typeof action>[0]);
}

describe("forgot-password confirm step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyOtp.mockResolvedValue({
      data: {
        user: { id: "user-1" },
        session: { access_token: "recovery-token" },
      },
      error: null,
    });
    mockSignOut.mockResolvedValue({ error: null });
  });

  it("refuses to set a password for an address that must use SSO", async () => {
    mockGetLegacyLoginDecision.mockResolvedValue({
      allowed: false,
      reason: "sso_domain",
    });

    const res = observable(await confirmReset("member@sso-corp.com"));

    expect(res.status).toBe(403);
    expect(res.errorMessage).toBe(
      "This email address signs in with single sign-on. Please use Login with SSO."
    );
    expect(updateAccountPassword).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledWith("recovery-token", "local");
  });

  it("revokes the recovery session and answers generically when the decision fails", async () => {
    mockGetLegacyLoginDecision.mockRejectedValue(new Error("database down"));

    const res = observable(await confirmReset("member@sso-corp.com"));

    expect(res.status).toBe(500);
    expect(res.errorMessage).toBe(
      "Something went wrong. Please try again later or contact support."
    );
    expect(updateAccountPassword).not.toHaveBeenCalled();
    expect(mockSignOut).toHaveBeenCalledWith("recovery-token", "local");
  });

  it("revokes the recovery session when the password update refuses an SSO account", async () => {
    mockGetLegacyLoginDecision.mockResolvedValue({ allowed: true });
    vi.mocked(updateAccountPassword).mockRejectedValueOnce(
      new ShelfError({
        cause: null,
        message: "You cannot update the password of an SSO user.",
        label: "Auth",
      })
    );
    const destroySession = vi.fn();

    const res = observable(
      await confirmReset("member@sso-corp.com", destroySession)
    );

    expect(res.errorMessage).toBe(
      "You cannot update the password of an SSO user."
    );
    expect(mockSignOut).toHaveBeenCalledWith("recovery-token", "local");
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("asks the decision about the address the code verified", async () => {
    mockVerifyOtp.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "verified@sso-corp.com" },
        session: { access_token: "recovery-token" },
      },
      error: null,
    });
    mockGetLegacyLoginDecision.mockResolvedValue({ allowed: true });

    await confirmReset("posted@sso-corp.com");

    expect(mockGetLegacyLoginDecision).toHaveBeenCalledWith(
      "verified@sso-corp.com"
    );
  });

  it("asks the decision only after the code verifies", async () => {
    // A refusal before the code is checked would answer "is this address on
    // SSO?" for anyone who posts an address.
    mockVerifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new Error("invalid"),
    });

    const res = observable(await confirmReset("member@sso-corp.com"));

    expect(res.errorMessage).toBe("Invalid or expired verification code");
    expect(mockGetLegacyLoginDecision).not.toHaveBeenCalled();
  });

  it("sets the password for an allowed address", async () => {
    mockGetLegacyLoginDecision.mockResolvedValue({ allowed: true });

    const res = observable(await confirmReset("owner@sso-corp.com"));

    expect(updateAccountPassword).toHaveBeenCalledWith(
      "user-1",
      "new-password-1",
      "recovery-token"
    );
    expect(res.location).toBe("/login?password_reset=true");
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
