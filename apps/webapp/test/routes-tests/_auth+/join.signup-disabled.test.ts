// @vitest-environment node

/**
 * Signup page with self-service signup switched off (`DISABLE_SIGNUP`): the
 * action refuses on its own, so a POST straight to `/join` creates no account
 * even though it never loaded the page.
 *
 * @see {@link file://./../../../app/routes/_auth+/join.tsx}
 * @see {@link file://./../../../app/modules/auth/signup-gate.server.ts}
 */
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "~/config/types";

import { signUpWithEmailPass } from "~/modules/auth/service.server";
import { findUserByEmail } from "~/modules/user/service.server";
import { action } from "~/routes/_auth+/join";

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
// why: account creation is a Supabase call; the tests assert whether it runs.
vi.mock("~/modules/auth/service.server", () => ({
  signUpWithEmailPass: vi.fn(),
}));
// why: the duplicate-email check is a database lookup.
vi.mock("~/modules/user/service.server", () => ({
  findUserByEmail: vi.fn(),
}));
// why: the SSO-domain gate is a network lookup.
vi.mock("~/utils/sso.server", () => ({
  validateNonSSOSignup: vi.fn(),
}));
// why: importing the route transitively loads ~/database/db.server, whose
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

const PASSWORD = "correct-horse-battery";

/** A signup POST for a new address. */
function signupArgs() {
  return {
    request: new Request("http://localhost:3000/join", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        email: "new.person@example.com",
        password: PASSWORD,
        confirmPassword: PASSWORD,
      }),
    }),
    context: { isAuthenticated: false },
    params: {},
  } as unknown as ActionFunctionArgs;
}

describe("join action with signup disabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findUserByEmail).mockResolvedValue(null);
  });

  it("refuses with 403 and creates no account", async () => {
    signup.disabled = true;

    const response = (await action(signupArgs())) as Response;

    expect(response.status).toBe(403);
    expect(signUpWithEmailPass).not.toHaveBeenCalled();
  });

  it("signs up as usual when signup is enabled", async () => {
    signup.disabled = false;

    const response = (await action(signupArgs())) as Response;

    expect(response.status).toBe(302);
    expect(signUpWithEmailPass).toHaveBeenCalledTimes(1);
  });
});
