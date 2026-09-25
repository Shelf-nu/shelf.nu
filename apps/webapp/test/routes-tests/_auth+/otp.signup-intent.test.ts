// @vitest-environment node

/**
 * Code confirmation: a new account records the signup link's intent on its
 * signup event, and the cookie is handed on to onboarding. `redirectTo` only
 * decides where an onboarded account lands; every other account lands on
 * `/assets`, whose layout sends it to onboarding. A login ignores the intent.
 *
 * @see {@link file://./../../../app/routes/_auth+/otp.tsx}
 * @see {@link file://./../../../app/modules/signup-intent/cookie.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_EMAIL, USER_ID, ORGANIZATION_ID } from "@mocks/user";

import { verifyOtpAndSignin } from "~/modules/auth/service.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import {
  readSignupIntent,
  serializeSignupIntent,
} from "~/modules/signup-intent/cookie.server";
import { createUser, findUserByEmail } from "~/modules/user/service.server";
import { generateUniqueUsername } from "~/modules/user/utils.server";
import { action } from "~/routes/_auth+/otp";

// why: code verification is a Supabase call; the tests assert on the
// redirect and the cookies it carries.
vi.mock("~/modules/auth/service.server", () => ({
  verifyOtpAndSignin: vi.fn(),
}));
// why: the new-user branch creates a database row; the tests only check that
// it is reached, not what it writes.
vi.mock("~/modules/user/service.server", () => ({
  createUser: vi.fn(),
  findUserByEmail: vi.fn(),
}));
// why: username generation queries the database for collisions
vi.mock("~/modules/user/utils.server", () => ({
  generateUniqueUsername: vi.fn(),
}));
// why: the workspace cookie is a fixed string here so the intent cookie can
// be told apart from it in the response headers
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(),
}));
// why: importing the otp route transitively loads ~/database/db.server, whose
// module-level connect rejects in a DB-less test env.
vi.mock("~/database/db.server", () => ({ db: {} }));

function confirmArgs(cookie?: string, mode?: string) {
  const headers = new Headers({
    "Content-Type": "application/x-www-form-urlencoded",
  });
  if (cookie) {
    headers.set("Cookie", cookie);
  }
  return {
    request: new Request(
      mode
        ? `http://localhost:3000/otp?mode=${mode}`
        : "http://localhost:3000/otp",
      {
        method: "POST",
        headers,
        body: new URLSearchParams({ email: USER_EMAIL, otp: "123456" }),
      }
    ),
    context: { isAuthenticated: false, setSession: vi.fn() },
    params: {},
  } as unknown as ActionFunctionArgs;
}

async function intentCookie(
  intent: Parameters<typeof serializeSignupIntent>[0]
) {
  return (await serializeSignupIntent(intent)).split(";")[0];
}

async function signupIntentSetBy(response: Response) {
  const setCookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("signup-intent="));
  if (!setCookie) {
    return null;
  }
  return readSignupIntent(
    new Request("http://localhost:3000/onboarding", {
      headers: { Cookie: setCookie.split(";")[0] },
    })
  );
}

describe("otp action — confirming the code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyOtpAndSignin).mockResolvedValue({
      userId: USER_ID,
      email: USER_EMAIL,
    } as never);
    vi.mocked(findUserByEmail).mockResolvedValue(null);
    vi.mocked(generateUniqueUsername).mockResolvedValue("new-person");
    vi.mocked(createUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: ORGANIZATION_ID,
    } as never);
    vi.mocked(setSelectedOrganizationIdCookie).mockResolvedValue(
      "selected-organization-id=org"
    );
  });

  it("lands on the assets page and sets only the workspace cookie without an intent", async () => {
    const response = (await action(confirmArgs())) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/assets");
    expect(response.headers.getSetCookie()).toEqual([
      "selected-organization-id=org",
    ]);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ signupIntent: null })
    );
  });

  it("hands the intent on to onboarding with a fresh window", async () => {
    const intent = { plan: "team" as const, trial: true, utmSource: "website" };

    const response = (await action(
      confirmArgs(await intentCookie(intent))
    )) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/assets");
    expect(response.headers.getSetCookie()[0]).toBe(
      "selected-organization-id=org"
    );
    await expect(signupIntentSetBy(response)).resolves.toEqual(intent);
    // The new account records the intent on its signup event.
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ signupIntent: intent })
    );
  });

  it("sends an onboarded account to the link's in-app redirectTo", async () => {
    vi.mocked(findUserByEmail).mockResolvedValue({
      id: USER_ID,
      onboarded: true,
    } as never);

    const response = (await action(
      confirmArgs(await intentCookie({ redirectTo: "/qr/abc?x=1" }))
    )) as Response;

    expect(response.headers.get("Location")).toBe("/qr/abc?x=1");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("sends a new account to /assets, and so to onboarding, whatever the redirectTo", async () => {
    const response = (await action(
      confirmArgs(await intentCookie({ redirectTo: "/qr/abc" }))
    )) as Response;

    expect(response.headers.get("Location")).toBe("/assets");
    expect(createUser).toHaveBeenCalledTimes(1);
    // The intent still travels on for onboarding to consume.
    await expect(signupIntentSetBy(response)).resolves.toEqual({
      redirectTo: "/qr/abc",
    });
  });

  it("sends an account that has not onboarded to /assets, whatever the redirectTo", async () => {
    vi.mocked(findUserByEmail).mockResolvedValue({
      id: USER_ID,
      onboarded: false,
    } as never);

    const response = (await action(
      confirmArgs(await intentCookie({ redirectTo: "/qr/abc" }))
    )) as Response;

    expect(response.headers.get("Location")).toBe("/assets");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("ignores a leftover intent when the code is for a login", async () => {
    vi.mocked(findUserByEmail).mockResolvedValue({
      id: USER_ID,
      onboarded: true,
    } as never);

    const response = (await action(
      confirmArgs(
        await intentCookie({ plan: "team", redirectTo: "/qr/abc" }),
        "login"
      )
    )) as Response;

    expect(response.headers.get("Location")).toBe("/assets");
    expect(response.headers.getSetCookie()).toEqual([
      "selected-organization-id=org",
    ]);
  });

  it("never follows a redirectTo off our origin", async () => {
    // Onboarded, so the only thing keeping it on /assets is safeRedirect.
    vi.mocked(findUserByEmail).mockResolvedValue({
      id: USER_ID,
      onboarded: true,
    } as never);

    const response = (await action(
      confirmArgs(await intentCookie({ redirectTo: "https://evil.example/x" }))
    )) as Response;

    expect(response.headers.get("Location")).toBe("/assets");
  });
});
