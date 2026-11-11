// @vitest-environment node

/**
 * Code confirmation with self-service signup switched off (`DISABLE_SIGNUP`):
 * a verified code for an auth user with no Shelf account is a signup, so it
 * creates no account and starts no session. People who already have an
 * account still sign in.
 *
 * @see {@link file://./../../../app/routes/_auth+/otp.tsx}
 * @see {@link file://./../../../app/modules/auth/signup-gate.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { USER_EMAIL, USER_ID, ORGANIZATION_ID } from "@mocks/user";

import type { Config } from "~/config/types";

import {
  endSessionByRefreshToken,
  verifyOtpAndSignin,
} from "~/modules/auth/service.server";
import {
  getSelectedOrganization,
  setSelectedOrganizationIdCookie,
} from "~/modules/organization/context.server";
import { createUser, findUserById } from "~/modules/user/service.server";
import { generateUniqueUsername } from "~/modules/user/utils.server";
import { action } from "~/routes/_auth+/otp";

/** The switch the tests flip; read by the mocked config on every access. */
const signup = vi.hoisted(() => ({ disabled: true }));

// why: `config.disableSignup` comes from the environment at import time; the
// tests need to flip it per case.
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const actual = await importOriginal<{ config: Config }>();
  return {
    config: {
      ...actual.config,
      get disableSignup() {
        return signup.disabled;
      },
    },
  };
});
// why: code verification is a Supabase call.
vi.mock("~/modules/auth/service.server", () => ({
  verifyOtpAndSignin: vi.fn(),
  endSessionByRefreshToken: vi.fn(),
}));
// why: the new-user branch writes a database row; the tests assert whether it
// is reached.
vi.mock("~/modules/user/service.server", () => ({
  createUser: vi.fn(),
  findUserById: vi.fn(),
}));
// why: username generation queries the database for collisions.
vi.mock("~/modules/user/utils.server", () => ({
  generateUniqueUsername: vi.fn(),
}));
// why: workspace selection reads the database.
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(),
  setSelectedOrganizationIdCookie: vi.fn(),
}));
// why: importing the otp route transitively loads ~/database/db.server, whose
// module-level connect rejects in a DB-less test env.
vi.mock("~/database/db.server", () => ({ db: {} }));

const createDataMock = vi.hoisted(() => {
  return () =>
    vi.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    });
});

// why: makes the action's data() result a readable Response with a status.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

/** A code confirmation POST, with the session setter exposed for assertions. */
function confirmArgs() {
  const setSession = vi.fn();
  const args = {
    request: new Request("http://localhost:3000/otp?mode=confirm_signup", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: USER_EMAIL, otp: "123456" }),
    }),
    context: { isAuthenticated: false, setSession },
    params: {},
  } as unknown as ActionFunctionArgs;
  return { args, setSession };
}

describe("otp action with signup disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signup.disabled = true;
    vi.mocked(verifyOtpAndSignin).mockResolvedValue({
      userId: USER_ID,
      email: USER_EMAIL,
      refreshToken: "refresh-1",
    } as never);
    vi.mocked(generateUniqueUsername).mockResolvedValue("new-person");
    vi.mocked(createUser).mockResolvedValue({ id: USER_ID } as never);
    vi.mocked(getSelectedOrganization).mockResolvedValue({
      organizationId: ORGANIZATION_ID,
    } as never);
    vi.mocked(setSelectedOrganizationIdCookie).mockResolvedValue(
      "selected-organization-id=org"
    );
  });

  it("refuses with 403 when the code belongs to no Shelf account", async () => {
    vi.mocked(findUserById).mockResolvedValue(null);
    const { args, setSession } = confirmArgs();

    const response = (await action(args)) as Response;

    expect(response.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    // The session the verified code opened is ended, not left behind.
    expect(endSessionByRefreshToken).toHaveBeenCalledWith("refresh-1");
  });

  it("still signs an existing account in", async () => {
    vi.mocked(findUserById).mockResolvedValue({
      id: USER_ID,
      onboarded: true,
    } as never);
    const { args, setSession } = confirmArgs();

    const response = (await action(args)) as Response;

    expect(response.status).toBe(302);
    expect(setSession).toHaveBeenCalledTimes(1);
    expect(createUser).not.toHaveBeenCalled();
  });

  it("creates the account when signup is enabled", async () => {
    signup.disabled = false;
    vi.mocked(findUserById).mockResolvedValue(null);
    const { args } = confirmArgs();

    const response = (await action(args)) as Response;

    expect(response.status).toBe(302);
    expect(createUser).toHaveBeenCalledTimes(1);
  });
});
