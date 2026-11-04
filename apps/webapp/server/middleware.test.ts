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
 * @see {@link file://./middleware.ts}
 */
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateSession } from "~/modules/auth/service.server";
import { protect } from "./middleware";
import { authSessionKey } from "./session";

// why: the session lives in a signed cookie managed by remix-hono; each case
// supplies the session state directly and the assertions read what was flashed
const session = {
  get: vi.fn(),
  flash: vi.fn(),
  unset: vi.fn(),
};
vi.mock("remix-hono/session", () => ({ getSession: () => session }));

// why: validateSession queries auth.refresh_tokens in Postgres
vi.mock("~/modules/auth/service.server", () => ({
  validateSession: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

/** An app with only the protect middleware in front of a page that answers 200. */
function app() {
  const server = new Hono();
  server.use(
    "*",
    protect({ onFailRedirectTo: "/login", publicPaths: ["/login"] })
  );
  server.get("*", (c) => c.text("page"));
  return server;
}

describe("protect: sending a signed-out request to login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when the session was revoked", () => {
    beforeEach(() => {
      session.get.mockImplementation((key: string) =>
        key === authSessionKey ? { refreshToken: "revoked" } : undefined
      );
      vi.mocked(validateSession).mockResolvedValue(false);
    });

    it("answers a client-side navigation with a single-fetch redirect", async () => {
      const res = await app().request(
        "/kits.data?_routes=routes%2F_layout%2B%2Fkits"
      );

      expect(res.status).toBe(204);
      expect(res.headers.get("X-Remix-Redirect")).toBe(
        "/login?redirectTo=/kits"
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
      expect(res.headers.get("Location")).toBe("/login?redirectTo=/kits");
      expect(res.headers.get("X-Remix-Redirect")).toBeNull();
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
    session.get.mockReturnValue({ refreshToken: "valid" });
    vi.mocked(validateSession).mockResolvedValue(true);

    const res = await app().request("/kits.data");

    expect(res.status).toBe(200);
  });
});
