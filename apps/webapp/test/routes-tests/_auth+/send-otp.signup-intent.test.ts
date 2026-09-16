// @vitest-environment node

/**
 * One-time-code request: the second signup path. It only passes the signup
 * link's intent along; the SSO-domain gate for signups is unchanged.
 *
 * @see {@link file://./../../../app/routes/_auth+/send-otp.tsx}
 * @see {@link file://./../../../app/modules/signup-intent/cookie.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendOTP } from "~/modules/auth/service.server";
import {
  readSignupIntent,
  serializeSignupIntent,
} from "~/modules/signup-intent/cookie.server";
import { validateNonSSOSignup } from "~/utils/sso.server";
import { action } from "~/routes/_auth+/send-otp";

// why: sending a code is a Supabase call; the tests assert on the redirect.
vi.mock("~/modules/auth/service.server", () => ({
  sendOTP: vi.fn(),
}));
// why: the SSO-domain gate is a network lookup; only its wiring is checked.
vi.mock("~/utils/sso.server", () => ({
  validateNonSSOSignup: vi.fn(),
}));
// why: importing the route transitively loads ~/database/db.server, whose
// module-level connect rejects in a DB-less test env.
vi.mock("~/database/db.server", () => ({ db: {} }));

const EMAIL = "new.person@example.com";
const INTENT = { plan: "team" as const, trial: true, utmSource: "website" };

function sendOtpArgs({
  mode,
  cookie,
}: {
  mode: "signup" | "login";
  cookie?: string;
}) {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return {
    request: new Request("http://localhost:3000/send-otp", {
      method: "POST",
      headers,
      body: new URLSearchParams({ email: EMAIL, mode }),
    }),
    context: {},
    params: {},
  } as unknown as ActionFunctionArgs;
}

async function signupIntentSetBy(response: Response) {
  const setCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("signup-intent="));
  if (!setCookie) {
    return null;
  }
  return readSignupIntent(
    new Request("http://localhost:3000/otp", {
      headers: { Cookie: setCookie.split(";")[0] },
    })
  );
}

describe("send-otp action — signup by one-time code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sendOTP).mockResolvedValue(undefined);
    vi.mocked(validateNonSSOSignup).mockResolvedValue(undefined);
  });

  it("hands the intent on to the code step with a fresh window", async () => {
    const cookie = (await serializeSignupIntent(INTENT)).split(";")[0];

    const response = (await action(
      sendOtpArgs({ mode: "signup", cookie })
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `/otp?email=${encodeURIComponent(EMAIL)}&mode=signup`
    );
    await expect(signupIntentSetBy(response)).resolves.toEqual(INTENT);
    expect(validateNonSSOSignup).toHaveBeenCalledWith(EMAIL);
    expect(sendOTP).toHaveBeenCalledWith(EMAIL);
  });

  it("redirects exactly as before when no intent is being carried", async () => {
    const response = (await action(
      sendOtpArgs({ mode: "signup" })
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `/otp?email=${encodeURIComponent(EMAIL)}&mode=signup`
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("does not run the signup-only SSO gate for a login code", async () => {
    const response = (await action(sendOtpArgs({ mode: "login" }))) as Response;

    expect(response.status).toBe(302);
    expect(validateNonSSOSignup).not.toHaveBeenCalled();
  });

  it("does not hand anything on when the SSO gate refuses", async () => {
    vi.mocked(validateNonSSOSignup).mockRejectedValue(
      Object.assign(new Error("This email domain uses SSO authentication."), {
        status: 400,
      })
    );
    const cookie = (await serializeSignupIntent(INTENT)).split(";")[0];

    const response = (await action(
      sendOtpArgs({ mode: "signup", cookie })
    )) as Response;

    expect(response.status).not.toBe(302);
    expect(sendOTP).not.toHaveBeenCalled();
  });
});
