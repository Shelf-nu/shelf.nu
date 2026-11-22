/**
 * Email login switch middleware: ending web sessions that were not obtained
 * through single sign-on while `DISABLE_EMAIL_LOGIN` is on.
 *
 * It runs in front of `protect`, as in the server, on every request: a page and
 * an API route alike. An ended session reaches `protect` as signed out, which
 * sends the person to the login page and says they were logged out.
 *
 * @see {@link file://./middleware.ts} endEmailLoginSessions
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ShelfConfigModule from "~/config/shelf.config";
import { revokeSession, validateSession } from "~/modules/auth/service.server";
import { endEmailLoginSessions, protect } from "./middleware";
import { authSessionKey } from "./session";

// @vitest-environment node

// why: the session lives in a signed cookie managed by remix-hono; the stub
// keeps the auth entry until the middleware unsets it, as the real one does.
const cookie = vi.hoisted(() => ({ auth: undefined as unknown }));
const session = {
  get: vi.fn((key: string) => (key === authSessionKey ? cookie.auth : null)),
  set: vi.fn(),
  flash: vi.fn(),
  unset: vi.fn(() => {
    cookie.auth = undefined;
  }),
};
vi.mock("remix-hono/session", () => ({ getSession: () => session }));

// why: revoking a session and validating a refresh token are Supabase Auth and
// Postgres calls; the spies record whether they were made.
vi.mock("~/modules/auth/service.server", () => ({
  revokeSession: vi.fn(),
  validateSession: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

// why: DISABLE_EMAIL_LOGIN is read from the environment when the config module
// loads; the getter switches it per test while every other value stays real.
const emailLogin = vi.hoisted(() => ({ disabled: true }));
vi.mock("~/config/shelf.config", async (importOriginal) => {
  const original = await importOriginal<typeof ShelfConfigModule>();
  return {
    config: {
      ...original.config,
      get disableEmailLogin() {
        return emailLogin.disabled;
      },
    },
  };
});

/** The middleware and `protect`, in server order, in front of any route. */
function app() {
  const server = new Hono();
  server.use("*", endEmailLoginSessions());
  server.use(
    "*",
    protect({ onFailRedirectTo: "/login", publicPaths: ["/login"] })
  );
  server.get("*", (c) => c.text("ok"));
  return server;
}

/**
 * Builds an access token whose `amr` claim records how the session was
 * obtained. Only the payload is read, so header and signature are fillers.
 */
function tokenObtainedWith(method: string) {
  const payload = Buffer.from(
    JSON.stringify({ amr: [{ method, timestamp: 1 }] })
  ).toString("base64url");
  return `header.${payload}.signature`;
}

/** Signs the cookie in with a session whose sign-in went through `method`. */
function signedInWith(method: string) {
  const accessToken = tokenObtainedWith(method);
  cookie.auth = {
    userId: "user-1",
    email: "jane@example.com",
    accessToken,
    refreshToken: "refresh-token",
    expiresIn: 3600,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
  return accessToken;
}

beforeEach(() => {
  vi.clearAllMocks();
  emailLogin.disabled = true;
  vi.mocked(validateSession).mockResolvedValue(true);
});

describe("endEmailLoginSessions", () => {
  it.each(["/assets", "/api/model-filters"])(
    "ends a password session on %s, revoking only that session",
    async (path) => {
      const token = signedInWith("password");

      const response = await app().request(`https://app.shelf.nu${path}`);

      expect(revokeSession).toHaveBeenCalledWith(token);
      expect(session.unset).toHaveBeenCalledWith(authSessionKey);
      expect(response.status).toBe(302);
      expect(response.headers.get("Location")).toBe(
        `/login?redirectTo=${path}&logged_out=1`
      );
    }
  );

  it.each(["oauth", "sso/saml"])(
    "keeps a session obtained through %s",
    async (method) => {
      signedInWith(method);

      const response = await app().request("https://app.shelf.nu/assets");

      expect(revokeSession).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    }
  );

  it("leaves every session alone while email login is on", async () => {
    signedInWith("password");
    emailLogin.disabled = false;

    const response = await app().request("https://app.shelf.nu/assets");

    expect(revokeSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("does nothing for a visitor without a session", async () => {
    cookie.auth = undefined;

    const response = await app().request("https://app.shelf.nu/login");

    expect(revokeSession).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});
