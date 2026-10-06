/**
 * Tests for the SSO guard on the legacy sign-in paths in the auth service:
 * password login, sending an email OTP, sending a password reset code, and
 * verifying an email OTP.
 *
 * The decision is per-account, so no response given before authentication may
 * depend on it:
 * - password login and code verification ask it only after Supabase accepts
 *   the credentials, revoke the session that opened when it refuses, and only
 *   then answer (403 for a password, the wrong-code error for a code);
 * - sending a code or a reset link refuses silently, returning as a send does.
 *
 * The post-authentication decision is asked for the session's own user id.
 * `revokeAllSessions`, which ends a refused account's other sessions, is
 * covered at the end.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./sso-enforcement.server.ts} the decision itself
 */
import { AuthApiError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  INVALID_CREDENTIALS_MESSAGE,
  INVALID_OTP_MESSAGE,
  revokeAllSessions,
  sendOTP,
  sendResetPasswordLink,
  signInWithEmail,
  verifyOtpAndSignin,
} from "./service.server";
import type * as SsoEnforcementModule from "./sso-enforcement.server";
import {
  getLegacyLoginDecision,
  getLegacyLoginDecisionForUser,
} from "./sso-enforcement.server";

// why: the decision has its own tests (sso-enforcement.server.test.ts); here
// only when each path asks it, and what it does with the answer, matters. The
// error builder stays real so the 403 is the one users actually see.
vi.mock("./sso-enforcement.server", async (importOriginal) => {
  const actual = await importOriginal<typeof SsoEnforcementModule>();
  return {
    createSsoRequiredError: actual.createSsoRequiredError,
    getLegacyLoginDecision: vi.fn(),
    getLegacyLoginDecisionForUser: vi.fn(),
  };
});

// why: the service module imports the database client at load; no test here
// reaches a query.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: every guarded path ends in a Supabase Auth network call; the spies let
// the tests assert whether it was made, and whether a session was revoked.
const supabaseMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  admin: { signOut: vi.fn() },
}));
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(() => ({ auth: supabaseMocks })),
}));

const EMAIL = "jane@acme.com";

/** A Supabase session shaped the way `mapAuthSession` reads it. */
const SUPABASE_SESSION = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
  expires_at: 1_000,
  user: { id: "user-1", email: EMAIL },
};

/** The decision asked after authentication, keyed by the session's user. */
const AUTHENTICATED_DECISION_ARGS = { userId: "user-1", email: EMAIL };

/** Makes the decision refuse the address, by address and by user alike. */
function givenRefused() {
  const refused = { allowed: false, reason: "sso_domain" } as const;
  vi.mocked(getLegacyLoginDecision).mockResolvedValue(refused);
  vi.mocked(getLegacyLoginDecisionForUser).mockResolvedValue(refused);
}

/** Captures what a promise rejects with. */
async function rejectionOf(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (cause: unknown) => cause
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getLegacyLoginDecision).mockResolvedValue({ allowed: true });
  vi.mocked(getLegacyLoginDecisionForUser).mockResolvedValue({ allowed: true });
  supabaseMocks.signInWithPassword.mockResolvedValue({
    data: { session: SUPABASE_SESSION },
    error: null,
  });
  supabaseMocks.signInWithOtp.mockResolvedValue({ error: null });
  supabaseMocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  supabaseMocks.verifyOtp.mockResolvedValue({
    data: { session: SUPABASE_SESSION },
    error: null,
  });
  supabaseMocks.admin.signOut.mockResolvedValue({ data: null, error: null });
});

describe("signInWithEmail", () => {
  it("gives a wrong password the generic error without asking the decision", async () => {
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(
        "Invalid login credentials",
        400,
        "invalid_credentials"
      ),
    });
    givenRefused();

    await expect(
      signInWithEmail(EMAIL, "wrong-password")
    ).rejects.toMatchObject({
      message: INVALID_CREDENTIALS_MESSAGE,
      shouldBeCaptured: false,
    });
    expect(getLegacyLoginDecisionForUser).not.toHaveBeenCalled();
    expect(supabaseMocks.admin.signOut).not.toHaveBeenCalled();
  });

  it("revokes the new session and refuses with a 403 when the right password belongs to a refused address", async () => {
    givenRefused();

    await expect(signInWithEmail(EMAIL, "password123")).rejects.toMatchObject({
      status: 403,
      title: "Single sign-on required",
      message:
        "This email address signs in with single sign-on. Please use Login with SSO.",
      shouldBeCaptured: false,
    });
    expect(getLegacyLoginDecisionForUser).toHaveBeenCalledWith(
      AUTHENTICATED_DECISION_ARGS
    );
    expect(getLegacyLoginDecision).not.toHaveBeenCalled();
    expect(supabaseMocks.admin.signOut).toHaveBeenCalledWith("access", "local");
  });

  it("still refuses when revoking the session fails", async () => {
    givenRefused();
    supabaseMocks.admin.signOut.mockResolvedValue({
      data: null,
      error: new AuthApiError("session not found", 404, "session_not_found"),
    });

    await expect(signInWithEmail(EMAIL, "password123")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("revokes the new session when the decision cannot be made", async () => {
    vi.mocked(getLegacyLoginDecisionForUser).mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(signInWithEmail(EMAIL, "password123")).rejects.toBeDefined();
    expect(supabaseMocks.admin.signOut).toHaveBeenCalledWith("access", "local");
  });

  it("signs in an allowed address", async () => {
    const session = await signInWithEmail(EMAIL, "password123");

    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: "password123",
    });
    expect(getLegacyLoginDecisionForUser).toHaveBeenCalledWith(
      AUTHENTICATED_DECISION_ARGS
    );
    expect(supabaseMocks.admin.signOut).not.toHaveBeenCalled();
    expect(session).toMatchObject({
      userId: "user-1",
      email: EMAIL,
      accessToken: "access",
    });
  });
});

describe("sendOTP", () => {
  it("sends nothing to a refused address and returns as a send does", async () => {
    givenRefused();

    await expect(sendOTP(EMAIL)).resolves.toBeUndefined();
    expect(supabaseMocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends a code to an allowed address", async () => {
    await expect(sendOTP(EMAIL)).resolves.toBeUndefined();

    expect(getLegacyLoginDecision).toHaveBeenCalledWith(EMAIL);
    expect(supabaseMocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL })
    );
  });
});

describe("sendResetPasswordLink", () => {
  it("sends nothing to a refused address and returns as a send does", async () => {
    givenRefused();

    await expect(sendResetPasswordLink(EMAIL)).resolves.toBeUndefined();
    expect(supabaseMocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends a reset code to an allowed address", async () => {
    await expect(sendResetPasswordLink(EMAIL)).resolves.toBeUndefined();

    expect(getLegacyLoginDecision).toHaveBeenCalledWith(EMAIL);
    expect(supabaseMocks.resetPasswordForEmail).toHaveBeenCalledWith(EMAIL);
  });
});

describe("verifyOtpAndSignin", () => {
  /** The fields of a ShelfError a caller can observe. */
  function observable(error: unknown) {
    const { message, status, title, label, shouldBeCaptured, additionalData } =
      error as Record<string, unknown>;
    return { message, status, title, label, shouldBeCaptured, additionalData };
  }

  it("gives a wrong code the invalid-code error without asking the decision", async () => {
    supabaseMocks.verifyOtp.mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthApiError(INVALID_OTP_MESSAGE, 403, "otp_expired"),
    });

    await expect(verifyOtpAndSignin(EMAIL, "000000")).rejects.toMatchObject({
      message: INVALID_OTP_MESSAGE,
      shouldBeCaptured: false,
    });
    expect(getLegacyLoginDecisionForUser).not.toHaveBeenCalled();
  });

  it("revokes the session and answers a refused address exactly as a wrong code", async () => {
    supabaseMocks.verifyOtp.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: new AuthApiError(INVALID_OTP_MESSAGE, 403, "otp_expired"),
    });
    const wrongCode = await rejectionOf(verifyOtpAndSignin(EMAIL, "000000"));

    givenRefused();
    const refused = await rejectionOf(verifyOtpAndSignin(EMAIL, "123456"));

    expect(supabaseMocks.admin.signOut).toHaveBeenCalledWith("access", "local");
    expect(observable(refused)).toEqual(observable(wrongCode));
  });

  it("verifies the code and signs in an allowed address", async () => {
    const session = await verifyOtpAndSignin(EMAIL, "123456");

    expect(supabaseMocks.verifyOtp).toHaveBeenCalledWith({
      email: EMAIL,
      token: "123456",
      type: "email",
    });
    expect(getLegacyLoginDecisionForUser).toHaveBeenCalledWith(
      AUTHENTICATED_DECISION_ARGS
    );
    expect(supabaseMocks.admin.signOut).not.toHaveBeenCalled();
    expect(session).toMatchObject({ userId: "user-1", email: EMAIL });
  });
});

describe("revokeAllSessions", () => {
  it("signs the user out of every session", async () => {
    await revokeAllSessions("access");

    expect(supabaseMocks.admin.signOut).toHaveBeenCalledWith(
      "access",
      "global"
    );
  });

  it("does not throw when Supabase refuses the sign-out", async () => {
    supabaseMocks.admin.signOut.mockResolvedValue({
      data: null,
      error: new AuthApiError("session not found", 404, "session_not_found"),
    });

    await expect(revokeAllSessions("access")).resolves.toBeUndefined();
  });
});
