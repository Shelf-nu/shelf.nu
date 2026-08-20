// @vitest-environment node
/**
 * Forgot-password must not reveal whether an account exists.
 *
 * The action returned three distinguishable outcomes: an "unconfirmed user"
 * error for an unknown address, an "SSO user" error, and a redirect on
 * success. Anyone could therefore enumerate which addresses were registered,
 * and which were federated, one request at a time — `user.sso` is a per-user
 * flag, so answering it at all confirmed the account existed.
 *
 * The reset link is still only sent to a real, non-SSO account. What changed
 * is that the RESPONSE no longer distinguishes the cases.
 *
 * The domain-level SSO answer is deliberately kept: `checkDomainSSOStatus`
 * reads `auth.sso_domains` by domain alone and never touches the user table,
 * so it reveals nothing about any particular account — and it saves an SSO
 * user from waiting for an email that will never arrive.
 *
 * detail.dev finding D100.
 *
 * @see {@link file://./../../../app/routes/_auth+/forgot-password.tsx}
 */

const { mockSendResetPasswordLink } = vi.hoisted(() => ({
  mockSendResetPasswordLink: vi.fn().mockResolvedValue(undefined),
}));
// why: sends a real email, and is the sink these tests assert on.
vi.mock("~/modules/auth/service.server", () => ({
  sendResetPasswordLink: mockSendResetPasswordLink,
  updateAccountPassword: vi.fn(),
  signInWithEmail: vi.fn(),
}));

const { mockUserFindFirst } = vi.hoisted(() => ({
  mockUserFindFirst: vi.fn(),
}));
// why: chooses whether the account exists — the entire variable under test.
vi.mock("~/database/db.server", () => ({
  db: { user: { findFirst: mockUserFindFirst } },
}));

const { mockCheckDomainSSOStatus } = vi.hoisted(() => ({
  mockCheckDomainSSOStatus: vi.fn(),
}));
vi.mock("~/utils/sso.server", () => ({
  checkDomainSSOStatus: mockCheckDomainSSOStatus,
}));

import { action } from "~/routes/_auth+/forgot-password";

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
  const r = res as Response;
  return { status: r.status, location: r.headers?.get?.("Location") ?? null };
}

describe("forgot-password enumeration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckDomainSSOStatus.mockResolvedValue({ isConfiguredForSSO: false });
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

  it("still tells an SSO DOMAIN to use SSO, without a user lookup", async () => {
    // Domain-level config is discoverable by anyone from the login page, so
    // saying it leaks nothing — and silence here would strand a real user.
    mockCheckDomainSSOStatus.mockResolvedValue({ isConfiguredForSSO: true });

    await requestReset("someone@sso-corp.com");

    expect(mockUserFindFirst).not.toHaveBeenCalled();
    expect(mockSendResetPasswordLink).not.toHaveBeenCalled();
  });
});
