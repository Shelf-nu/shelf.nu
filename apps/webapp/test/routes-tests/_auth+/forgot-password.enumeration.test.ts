// @vitest-environment node
/**
 * Forgot-password must not reveal whether an account exists.
 *
 * The invariant: every outcome responds identically — same status, same
 * redirect target — whether the address is registered, federated, or unknown.
 * A reset link is still sent only to a real, non-SSO account; the response
 * simply does not say which case occurred.
 *
 * Eligibility follows the PER-USER `sso` flag, never the domain's SSO
 * configuration: a federated domain can still hold password accounts created
 * before it was configured, and those users must keep recovery.
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

  it("still sends for a LEGACY password account on an SSO domain", async () => {
    // Eligibility follows the per-user `sso` flag, not the domain's SSO
    // configuration: a federated domain can still hold password accounts
    // created before it was configured, and those users must keep recovery.
    mockUserFindFirst.mockResolvedValue({ id: "legacy-1", sso: false });

    await requestReset("old-timer@sso-corp.com");

    expect(mockSendResetPasswordLink).toHaveBeenCalledWith(
      "old-timer@sso-corp.com"
    );
  });
});
