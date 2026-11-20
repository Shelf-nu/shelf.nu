/**
 * Protected routes middleware: how a signed-out request is sent to login.
 *
 * A document request gets a plain 302. A client-side navigation is a single
 * fetch `*.data` request, which `fetch` follows on its own: a 302 there lands
 * on the HTML login page, which React Router cannot decode, and the member sees
 * the error boundary instead of the login page. So `*.data` requests get the
 * single-fetch redirect React Router reads (204 + `X-Remix-Redirect`), and
 * `redirectTo` names the page, never its `.data` URL.
 *
 * A member whose session ended (revoked, or its refresh failed) is told so on
 * the login page through `logged_out=1` in the URL. A visitor who never had a
 * session is not.
 *
 * The refresh token is checked against the user the same cookie names.
 *
 * @see {@link file://./middleware.ts}
 */
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshAccessToken,
  validateSession,
} from "~/modules/auth/service.server";
import { protect, refreshSession } from "./middleware";
import { authSessionKey } from "./session";

// why: the session lives in a signed cookie managed by remix-hono; each case
// supplies the session state directly and the assertions read what was flashed
const session = {
  get: vi.fn(),
  set: vi.fn(),
  flash: vi.fn(),
  unset: vi.fn(),
};
vi.mock("remix-hono/session", () => ({ getSession: () => session }));

// why: validateSession queries auth.refresh_tokens in Postgres
vi.mock("~/modules/auth/service.server", () => ({
  validateSession: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

/** The refresh and protect middlewares, in server order, in front of a page that answers 200. */
function app() {
  const server = new Hono();
  server.use("*", refreshSession());
  server.use(
    "*",
    protect({ onFailRedirectTo: "/login", publicPaths: ["/login"] })
  );
  server.get("*", (c) => c.text("page"));
  return server;
}

/** An access token far from expiry, so the refresh middleware leaves it alone. */
const FRESH = Math.floor(Date.now() / 1000) + 3600;

describe("protect: sending a signed-out request to login", () => {
  beforeEach(() => {
    // Reset, not clear: some cases give the session stub an implementation
    vi.resetAllMocks();
  });

  describe("when the session was revoked", () => {
    beforeEach(() => {
      session.get.mockImplementation((key: string) =>
        key === authSessionKey
          ? { refreshToken: "revoked", expiresAt: FRESH }
          : undefined
      );
      vi.mocked(validateSession).mockResolvedValue(false);
    });

    it("answers a client-side navigation with a single-fetch redirect", async () => {
      const res = await app().request(
        "/kits.data?_routes=routes%2F_layout%2B%2Fkits"
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("X-Remix-Redirect")).toBe(
        "/login?redirectTo=/kits&logged_out=1"
      );
      expect(res.headers.get("Location")).toBeNull();
      expect(session.unset).toHaveBeenCalledWith(authSessionKey);
      expect(session.flash).toHaveBeenCalledWith(
        "errorMessage",
        expect.any(String)
      );
    });

    it("answers a document request with a plain redirect", async () => {
      const res = await app().request("/kits");

      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(
        "/login?redirectTo=/kits&logged_out=1"
      );
      expect(res.headers.get("X-Remix-Redirect")).toBeNull();
    });
  });

  describe("when refreshing the session fails", () => {
    beforeEach(() => {
      // An access token past its expiry sends the request through a refresh,
      // which fails because the refresh token was revoked
      const auth = { refreshToken: "revoked", expiresAt: 1 };
      session.get.mockImplementation((key: string) =>
        key === authSessionKey ? auth : undefined
      );
      session.unset.mockImplementation(() => {
        session.get.mockReturnValue(undefined);
      });
      vi.mocked(refreshAccessToken).mockRejectedValue(new Error("revoked"));
    });

    it("tells the member they were logged out", async () => {
      const res = await app().request("/kits.data");

      expect(res.status).toBe(204);
      expect(res.headers.get("X-Remix-Redirect")).toBe(
        "/login?redirectTo=/kits&logged_out=1"
      );
    });
  });

  describe("when there is no session at all", () => {
    beforeEach(() => {
      session.get.mockReturnValue(undefined);
    });

    it("answers a client-side navigation with a single-fetch redirect", async () => {
      const res = await app().request("/assets.data");

      expect(res.status).toBe(204);
      expect(res.headers.get("X-Remix-Redirect")).toBe(
        "/login?redirectTo=/assets"
      );
    });
  });

  it("lets a valid session through", async () => {
    session.get.mockReturnValue({
      refreshToken: "valid",
      userId: "user-1",
      expiresAt: FRESH,
    });
    vi.mocked(validateSession).mockResolvedValue(true);

    const res = await app().request("/kits.data");

    expect(res.status).toBe(200);
  });

  it("checks the refresh token against the user the cookie names", async () => {
    session.get.mockReturnValue({
      refreshToken: "valid",
      userId: "user-1",
      expiresAt: FRESH,
    });
    vi.mocked(validateSession).mockResolvedValue(true);

    await app().request("/kits");

    expect(validateSession).toHaveBeenCalledWith("valid", "user-1");
  });
});

describe("refreshSession: the visitor IP reaches Supabase", () => {
  /** An access token past its expiry, so the request goes through a refresh. */
  const EXPIRED = { refreshToken: "refresh-token", expiresAt: 1 };

  beforeEach(() => {
    vi.resetAllMocks();
    session.get.mockImplementation((key: string) =>
      key === authSessionKey ? EXPIRED : undefined
    );
    vi.mocked(refreshAccessToken).mockResolvedValue({
      ...EXPIRED,
      expiresAt: FRESH,
    } as Awaited<ReturnType<typeof refreshAccessToken>>);
    vi.mocked(validateSession).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the address the Fly edge reported", async () => {
    // why: on Fly, Fly-Client-IP is the trusted source of the visitor IP
    vi.stubEnv("FLY_APP_NAME", "shelf-webapp");

    await app().request("/kits", {
      headers: { "Fly-Client-IP": "203.0.113.7" },
    });

    expect(refreshAccessToken).toHaveBeenCalledWith("refresh-token", {
      clientIp: "203.0.113.7",
    });
  });

  it("never passes a client-written X-Forwarded-For on an instance without trusted proxies", async () => {
    // why: off Fly with no TRUSTED_PROXY_HOPS, nothing in the request is trusted
    vi.stubEnv("FLY_APP_NAME", "");
    vi.stubEnv("TRUSTED_PROXY_HOPS", undefined);

    await app().request("/kits", {
      headers: { "X-Forwarded-For": "198.51.100.99" },
    });

    expect(refreshAccessToken).toHaveBeenCalledWith("refresh-token", {
      clientIp: null,
    });
  });
});
