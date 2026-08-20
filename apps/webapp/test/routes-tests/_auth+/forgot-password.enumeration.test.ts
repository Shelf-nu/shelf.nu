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
 * The send decision is made on the PER-USER `sso` flag, never on the domain's
 * SSO configuration: a federated domain can still hold legacy password
 * accounts, and gating on the domain locked those users out of recovery.
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

  it("still sends for a LEGACY password account on an SSO domain", async () => {
    // The reason the decision is made on the per-user flag rather than the
    // domain's SSO configuration. `sso: true` is only set when a user actually
    // arrives through SSO, so a federated domain can still hold password
    // accounts created before it was configured. Gating on the domain locked
    // those users out of password recovery entirely.
    mockUserFindFirst.mockResolvedValue({ id: "legacy-1", sso: false });

    await requestReset("old-timer@sso-corp.com");

    expect(mockSendResetPasswordLink).toHaveBeenCalledWith(
      "old-timer@sso-corp.com"
    );
  });
});
