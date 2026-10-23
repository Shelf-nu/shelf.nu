// @vitest-environment node
/**
 * Sending a one-time code must not reveal which addresses must use SSO.
 *
 * The SSO decision is per-account, and nobody is authenticated when a code is
 * requested. So a refused address is sent nothing, yet both routes that send a
 * code answer it exactly as they answer an address that gets one: `send-otp`
 * with the same redirect to `/otp`, `resend-otp` with the same success payload.
 *
 * The real `sendOTP` runs here; only the decision and Supabase are stubbed.
 *
 * @see {@link file://./../../../app/routes/_auth+/send-otp.tsx}
 * @see {@link file://./../../../app/routes/_auth+/resend-otp.tsx}
 * @see {@link file://./../../../app/modules/auth/service.server.ts} sendOTP
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getLegacyLoginDecision } from "~/modules/auth/sso-enforcement.server";
import { action as resendOtpAction } from "~/routes/_auth+/resend-otp";
import { action as sendOtpAction } from "~/routes/_auth+/send-otp";

// why: the decision has its own tests (sso-enforcement.server.test.ts); here
// only that its answer never reaches the response matters.
vi.mock("~/modules/auth/sso-enforcement.server", () => ({
  getLegacyLoginDecision: vi.fn(),
  createSsoRequiredError: vi.fn(),
}));

// why: sending the code is a Supabase network call; the spy shows whether a
// code went out.
const { mockSignInWithOtp } = vi.hoisted(() => ({
  mockSignInWithOtp: vi.fn(),
}));
vi.mock("~/integrations/supabase/client", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    auth: { signInWithOtp: mockSignInWithOtp },
  })),
}));

// why: the signup-only domain gate is a database lookup, and these tests send
// login codes, where it does not run.
vi.mock("~/utils/sso.server", () => ({
  validateNonSSOSignup: vi.fn(),
}));

// why: importing the routes loads ~/database/db.server, whose module-level
// connect rejects in a DB-less env; nothing here reaches a query.
vi.mock("~/database/db.server", () => ({ db: {} }));

const EMAIL = "member@sso-corp.com";

/** Builds a form POST to `path`. */
function post(path: string, fields: Record<string, string>) {
  return {
    request: new Request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    }),
    context: {},
    params: {},
  } as unknown as ActionFunctionArgs;
}

/** What a caller can observe of either action's response. */
function observable(res: unknown) {
  if (res instanceof Response) {
    return {
      status: res.status,
      location: res.headers.get("Location"),
      cookies: res.headers.getSetCookie(),
    };
  }
  const r = res as { init?: ResponseInit; data?: unknown };
  return { status: r.init?.status ?? null, body: r.data ?? res };
}

/** Sets the decision's answer for every address. */
function givenDecision(allowed: boolean) {
  vi.mocked(getLegacyLoginDecision).mockResolvedValue(
    allowed ? { allowed: true } : { allowed: false, reason: "sso_domain" }
  );
}

describe("one-time code requests answer refused addresses like any other", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignInWithOtp.mockResolvedValue({ error: null });
  });

  it("send-otp redirects a refused address exactly as an allowed one", async () => {
    givenDecision(true);
    const allowed = observable(
      await sendOtpAction(post("/send-otp", { email: EMAIL, mode: "login" }))
    );
    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);

    givenDecision(false);
    const refused = observable(
      await sendOtpAction(post("/send-otp", { email: EMAIL, mode: "login" }))
    );

    expect(allowed).toEqual({
      status: 302,
      location: `/otp?email=${encodeURIComponent(EMAIL)}&mode=login`,
      cookies: [],
    });
    expect(refused).toEqual(allowed);
    // The refused address was sent nothing.
    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
  });

  it("resend-otp answers a refused address exactly as an allowed one", async () => {
    givenDecision(true);
    const allowed = observable(
      await resendOtpAction(post("/resend-otp", { email: EMAIL }))
    );
    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);

    givenDecision(false);
    const refused = observable(
      await resendOtpAction(post("/resend-otp", { email: EMAIL }))
    );

    expect(refused).toEqual(allowed);
    expect(mockSignInWithOtp).toHaveBeenCalledTimes(1);
  });
});
