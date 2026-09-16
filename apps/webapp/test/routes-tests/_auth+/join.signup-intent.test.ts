// @vitest-environment node

/**
 * Signup page: the intent a signup link carries (`?plan=team&trial=true` and
 * the `utm_*` parameters) is read once here, shown as a confirmation line,
 * and handed to the rest of the flow in a signed cookie.
 *
 * @see {@link file://./../../../app/routes/_auth+/join.tsx}
 * @see {@link file://./../../../app/modules/signup-intent/cookie.server.ts}
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signUpWithEmailPass } from "~/modules/auth/service.server";
import {
  readSignupIntent,
  serializeSignupIntent,
} from "~/modules/signup-intent/cookie.server";
import { findUserByEmail } from "~/modules/user/service.server";
import { validateNonSSOSignup } from "~/utils/sso.server";
import { action, loader } from "~/routes/_auth+/join";

// why: account creation is a Supabase call; the tests assert on what the
// responses carry, not on the account.
vi.mock("~/modules/auth/service.server", () => ({
  signUpWithEmailPass: vi.fn(),
}));
// why: the duplicate-email check is a database lookup; each test decides
// whether the address is taken.
vi.mock("~/modules/user/service.server", () => ({
  findUserByEmail: vi.fn(),
}));
// why: the SSO-domain gate is a network lookup; the tests only check it still
// runs and still refuses.
vi.mock("~/utils/sso.server", () => ({
  validateNonSSOSignup: vi.fn(),
}));
// why: importing the route transitively loads ~/database/db.server, whose
// module-level connect rejects in a DB-less test env.
vi.mock("~/database/db.server", () => ({ db: {} }));

const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      const headers = new Headers(init?.headers);
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers,
      });
    });
});

// why: mocking Remix's data() so loader and action results are readable
// Responses (status, headers, JSON body) rather than internal payload objects.
// Headers go through `new Headers()` because the loader passes them as
// `[name, value]` tuples, exactly as the real data() accepts them.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

const EMAIL = "new.person@example.com";
const PASSWORD = "correct-horse-battery";
const TEAM_TRIAL_INTENT = {
  plan: "team" as const,
  trial: true,
  utmSource: "website",
  utmCampaign: "pricing",
};

/** A request carrying the given `Set-Cookie` value back as its `Cookie`. */
async function cookieHeaderFor(setCookieValue: string) {
  return setCookieValue.split(";")[0];
}

function loaderArgs(url: string, isAuthenticated = false) {
  return {
    request: new Request(url),
    context: { isAuthenticated },
    params: {},
  } as unknown as LoaderFunctionArgs;
}

function signupActionArgs({ cookie }: { cookie?: string } = {}) {
  const body = new URLSearchParams({
    email: EMAIL,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  });
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return {
    request: new Request("http://localhost:3000/join", {
      method: "POST",
      headers,
      body,
    }),
    context: { isAuthenticated: false },
    params: {},
  } as unknown as ActionFunctionArgs;
}

/** The `signup-intent` cookie a response sets, or null when it sets none. */
async function signupIntentSetBy(response: Response) {
  const setCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("signup-intent="));
  if (!setCookie) {
    return null;
  }
  const request = new Request("http://localhost:3000/otp", {
    headers: { Cookie: await cookieHeaderFor(setCookie) },
  });
  return readSignupIntent(request);
}

describe("join loader — reading the signup link", () => {
  it("stores the link's intent in a cookie and returns it for the confirmation line", async () => {
    const response = (await loader(
      loaderArgs(
        "http://localhost:3000/join?plan=team&trial=true&utm_source=website&utm_campaign=pricing"
      )
    )) as Response;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signupIntent).toEqual(TEAM_TRIAL_INTENT);
    await expect(signupIntentSetBy(response)).resolves.toEqual(
      TEAM_TRIAL_INTENT
    );
  });

  it("changes nothing when the link carries no intent", async () => {
    const response = (await loader(
      loaderArgs("http://localhost:3000/join")
    )) as Response;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.signupIntent).toBeNull();
    expect(body.title).toBe("Create an account");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("keeps a redirectTo alongside the plan", async () => {
    const response = (await loader(
      loaderArgs("http://localhost:3000/join?plan=team&redirectTo=%2Fqr%2Fabc")
    )) as Response;

    await expect(signupIntentSetBy(response)).resolves.toEqual({
      plan: "team",
      redirectTo: "/qr/abc",
    });
  });

  it("still sends a signed-in visitor to their assets, intent or not", async () => {
    const response = (await loader(
      loaderArgs("http://localhost:3000/join?plan=team&trial=true", true)
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/assets");
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});

describe("join action — password signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findUserByEmail).mockResolvedValue(null);
    vi.mocked(signUpWithEmailPass).mockResolvedValue({} as never);
    vi.mocked(validateNonSSOSignup).mockResolvedValue(undefined);
  });

  it("hands the intent on to the code step with a fresh window", async () => {
    const cookie = await cookieHeaderFor(
      await serializeSignupIntent(TEAM_TRIAL_INTENT)
    );

    const response = (await action(signupActionArgs({ cookie }))) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `/otp?email=${encodeURIComponent(EMAIL)}&mode=confirm_signup`
    );
    await expect(signupIntentSetBy(response)).resolves.toEqual(
      TEAM_TRIAL_INTENT
    );
  });

  it("redirects exactly as before when no intent is being carried", async () => {
    const response = (await action(signupActionArgs())) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `/otp?email=${encodeURIComponent(EMAIL)}&mode=confirm_signup`
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("still refuses an SSO domain before creating anything", async () => {
    vi.mocked(validateNonSSOSignup).mockRejectedValue(
      Object.assign(new Error("This email domain uses SSO authentication."), {
        status: 400,
      })
    );
    const cookie = await cookieHeaderFor(
      await serializeSignupIntent(TEAM_TRIAL_INTENT)
    );

    const response = (await action(signupActionArgs({ cookie }))) as Response;

    expect(response.status).not.toBe(302);
    expect(validateNonSSOSignup).toHaveBeenCalledWith(EMAIL);
    expect(signUpWithEmailPass).not.toHaveBeenCalled();
  });
});
