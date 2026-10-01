/**
 * Tests for the SSO guard on the legacy sign-in paths in the auth service:
 * password login, sending an email OTP, sending a password reset code, and
 * verifying an email OTP.
 *
 * Each path must ask the SSO decision before Supabase, and a refusal must reach
 * the caller as the original 403 (status, title and message) rather than the
 * service's generic "something went wrong" wrapper, because the routes render
 * that message to the person signing in.
 *
 * @see {@link file://./service.server.ts}
 * @see {@link file://./sso-enforcement.server.ts} the decision itself
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ShelfError } from "~/utils/error";
import {
  sendOTP,
  sendResetPasswordLink,
  signInWithEmail,
  verifyOtpAndSignin,
} from "./service.server";
import { assertLegacyLoginAllowed } from "./sso-enforcement.server";

// why: the decision has its own tests (sso-enforcement.server.test.ts); here
// only whether each path asks it, and what it does with the answer, matters.
vi.mock("./sso-enforcement.server", () => ({
  assertLegacyLoginAllowed: vi.fn(),
}));

// why: the service module imports the database client at load; no test here
// reaches a query.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: every guarded path ends in a Supabase Auth network call; the spies let
// the tests assert whether it was made.
const supabaseMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
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

/** The refusal `assertLegacyLoginAllowed` throws for an address that must use SSO. */
function ssoRefusal() {
  return new ShelfError({
    cause: null,
    status: 403,
    title: "Single sign-on required",
    message:
      "This email address signs in with single sign-on. Please use Login with SSO.",
    label: "Auth",
    shouldBeCaptured: false,
  });
}

/** Asserts a rejection is the SSO refusal, unwrapped. */
async function expectSsoRefusal(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    status: 403,
    title: "Single sign-on required",
    message:
      "This email address signs in with single sign-on. Please use Login with SSO.",
    shouldBeCaptured: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertLegacyLoginAllowed).mockResolvedValue(undefined);
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
});

describe("signInWithEmail", () => {
  it("refuses an address that must use SSO without asking Supabase", async () => {
    vi.mocked(assertLegacyLoginAllowed).mockRejectedValue(ssoRefusal());

    await expectSsoRefusal(signInWithEmail(EMAIL, "password123"));
    expect(supabaseMocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in an allowed address", async () => {
    const session = await signInWithEmail(EMAIL, "password123");

    expect(assertLegacyLoginAllowed).toHaveBeenCalledWith(EMAIL);
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledWith({
      email: EMAIL,
      password: "password123",
    });
    expect(session).toMatchObject({ userId: "user-1", email: EMAIL });
  });
});

describe("sendOTP", () => {
  it("refuses an address that must use SSO without sending a code", async () => {
    vi.mocked(assertLegacyLoginAllowed).mockRejectedValue(ssoRefusal());

    await expectSsoRefusal(sendOTP(EMAIL));
    expect(supabaseMocks.signInWithOtp).not.toHaveBeenCalled();
  });

  it("sends a code to an allowed address", async () => {
    await sendOTP(EMAIL);

    expect(assertLegacyLoginAllowed).toHaveBeenCalledWith(EMAIL);
    expect(supabaseMocks.signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL })
    );
  });
});

describe("sendResetPasswordLink", () => {
  it("refuses an address that must use SSO without sending a code", async () => {
    vi.mocked(assertLegacyLoginAllowed).mockRejectedValue(ssoRefusal());

    await expectSsoRefusal(sendResetPasswordLink(EMAIL));
    expect(supabaseMocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("sends a reset code to an allowed address", async () => {
    await sendResetPasswordLink(EMAIL);

    expect(assertLegacyLoginAllowed).toHaveBeenCalledWith(EMAIL);
    expect(supabaseMocks.resetPasswordForEmail).toHaveBeenCalledWith(EMAIL);
  });
});

describe("verifyOtpAndSignin", () => {
  it("refuses an address that must use SSO without verifying the code", async () => {
    vi.mocked(assertLegacyLoginAllowed).mockRejectedValue(ssoRefusal());

    await expectSsoRefusal(verifyOtpAndSignin(EMAIL, "123456"));
    expect(supabaseMocks.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies the code and signs in an allowed address", async () => {
    const session = await verifyOtpAndSignin(EMAIL, "123456");

    expect(assertLegacyLoginAllowed).toHaveBeenCalledWith(EMAIL);
    expect(supabaseMocks.verifyOtp).toHaveBeenCalledWith({
      email: EMAIL,
      token: "123456",
      type: "email",
    });
    expect(session).toMatchObject({ userId: "user-1", email: EMAIL });
  });
});
