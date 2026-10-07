// @vitest-environment node
/**
 * Password login: the "use Login with SSO" hint.
 *
 * A wrong email/password pair for an address on a domain configured for SSO
 * gets a hint pointing at SSO login. Login runs before authentication, so the
 * hint may depend only on the DOMAIN: every address on that domain, with an
 * account or without, owner or not, gets the same response.
 *
 * @see {@link file://./../../../app/routes/_auth+/login.tsx}
 * @see {@link file://./../../../app/modules/auth/sso-enforcement.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INVALID_CREDENTIALS_MESSAGE,
  signInWithEmail,
} from "~/modules/auth/service.server";
import { createSsoRequiredError } from "~/modules/auth/sso-enforcement.server";
import { action } from "~/routes/_auth+/login";
import type * as EnvModule from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { checkDomainSSOStatus } from "~/utils/sso.server";

// why: signing in is a Supabase call; each test sets how it ends. The message
// constant stays real so the route matches what the service throws.
vi.mock("~/modules/auth/service.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/modules/auth/service.server")>();
  return {
    INVALID_CREDENTIALS_MESSAGE: actual.INVALID_CREDENTIALS_MESSAGE,
    signInWithEmail: vi.fn(),
  };
});

// why: the domain check reads auth.sso_domains; each test sets whether the
// domain is configured for SSO.
vi.mock("~/utils/sso.server", () => ({
  checkDomainSSOStatus: vi.fn(),
}));

// why: importing the route loads ~/database/db.server, whose module-level
// connect rejects in a DB-less env. The account lookup is a spy so the tests
// can prove the hint never reads the account.
vi.mock("~/database/db.server", () => ({
  db: { user: { findMany: vi.fn() } },
}));

// why: the failure path never selects an organization; stubbed so the import
// does not reach the database.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(),
}));

// why: DISABLE_SSO is read from the environment at import time; pinned so the
// result does not depend on the machine running the tests.
vi.mock("~/utils/env", async (importOriginal) => {
  const actual = await importOriginal<typeof EnvModule>();
  return { ...actual, DISABLE_SSO: false };
});

import { db } from "~/database/db.server";

/** POSTs the login form for `email`. */
function login(email: string) {
  return action({
    request: new Request("https://app.shelf.nu/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email, password: "wrong-password" }),
    }),
    context: { isAuthenticated: false, setSession: vi.fn() },
    params: {},
  } as unknown as ActionFunctionArgs);
}

/** What a caller can observe of the action's error response. */
function observable(res: unknown) {
  const r = res as {
    init?: ResponseInit;
    data?: {
      error?: { message?: string; title?: string };
      ssoDomainHint?: boolean;
    };
  };
  return {
    status: r.init?.status ?? null,
    message: r.data?.error?.message ?? null,
    title: r.data?.error?.title ?? null,
    ssoDomainHint: r.data?.ssoDomainHint ?? null,
  };
}

/** Sets whether the address's domain is configured for SSO. */
function givenDomainIsSso(isConfiguredForSSO: boolean) {
  vi.mocked(checkDomainSSOStatus).mockResolvedValue({
    isConfiguredForSSO,
    linkedOrganizations: [],
    ssoProviderId: isConfiguredForSSO ? "provider-1" : null,
  });
}

/** Makes Supabase reject the email/password pair. */
function givenWrongPassword() {
  vi.mocked(signInWithEmail).mockRejectedValue(
    new ShelfError({
      cause: null,
      message: INVALID_CREDENTIALS_MESSAGE,
      label: "Auth",
      shouldBeCaptured: false,
    })
  );
}

describe("login action: SSO domain hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    givenWrongPassword();
    givenDomainIsSso(false);
  });

  it("adds the hint to a wrong password on an SSO domain", async () => {
    givenDomainIsSso(true);

    const result = observable(await login("member@sso-corp.com"));

    expect(result.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(result.ssoDomainHint).toBe(true);
  });

  it("adds no hint on a domain not configured for SSO", async () => {
    const result = observable(await login("someone@example.com"));

    expect(result.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(result.ssoDomainHint).toBe(false);
  });

  it("answers the workspace owner exactly as any other address on the domain", async () => {
    givenDomainIsSso(true);

    const owner = observable(await login("owner@sso-corp.com"));
    const member = observable(await login("member@sso-corp.com"));
    const unknown = observable(await login("nobody@sso-corp.com"));

    expect(owner).toEqual(member);
    expect(unknown).toEqual(member);
    // The hint is a domain fact: no account is ever looked up for it.
    expect(db.user.findMany).not.toHaveBeenCalled();
  });

  it("adds no hint to the SSO-required refusal after a correct password", async () => {
    givenDomainIsSso(true);
    vi.mocked(signInWithEmail).mockRejectedValue(
      createSsoRequiredError("sso_domain")
    );

    const result = observable(await login("member@sso-corp.com"));

    expect(result.status).toBe(403);
    expect(result.title).toBe("Single sign-on required");
    expect(result.ssoDomainHint).toBe(false);
  });

  it("keeps the sign-in error when the domain lookup fails", async () => {
    vi.mocked(checkDomainSSOStatus).mockRejectedValue(
      new Error("database unavailable")
    );

    const result = observable(await login("member@sso-corp.com"));

    expect(result.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(result.ssoDomainHint).toBe(false);
  });
});
