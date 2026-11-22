// @vitest-environment node
/**
 * The logout action:
 * - ends the Supabase session that owns the cookie's refresh token, then
 *   clears the cookie (the helper is best-effort and never throws, which
 *   `app/modules/auth/service.server.test.ts` covers);
 * - follows a `redirectTo` from the form only when it stays on this app, so a
 *   cross-site form cannot sign a person out and send them to another site.
 *
 * @see {@link file://./../../../app/routes/_auth+/logout.tsx}
 */
import { createActionArgs } from "@mocks/remix";
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: the route imports cookie helpers and the auth service, which pull the
// Prisma client transitively; the session query is mocked below.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: ending the session is a raw delete against auth.sessions in Postgres;
// the tests assert which refresh token it is asked to end.
vi.mock("~/modules/auth/service.server", () => ({
  endSessionByRefreshToken: vi.fn(),
}));

const { endSessionByRefreshToken } = await import(
  "~/modules/auth/service.server"
);
const { action } = await import("~/routes/_auth+/logout");

/** A load context for a signed-in browser, or a signed-out one. */
function contextFor(auth: { refreshToken: string } | null) {
  return {
    isAuthenticated: auth !== null,
    getSession: vi.fn(() => auth),
    destroySession: vi.fn(),
  };
}

/**
 * Posts the logout form.
 *
 * @param fields - The form fields
 * @param context - The load context the action receives
 */
async function logout(
  fields: Record<string, string>,
  context = contextFor(null)
) {
  return (await action(
    createActionArgs({
      request: new Request("http://localhost/logout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      }),
      context: context as never,
    })
  )) as Response;
}

/**
 * Posts the logout form and returns where the response redirects.
 *
 * @param fields - The form fields
 */
async function logoutRedirect(fields: Record<string, string>) {
  return (await logout(fields)).headers.get("Location");
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("logout session", () => {
  it("ends the server session behind the cookie's refresh token", async () => {
    const context = contextFor({ refreshToken: "refresh-1" });

    const res = await logout({}, context);

    expect(endSessionByRefreshToken).toHaveBeenCalledWith("refresh-1");
    expect(context.destroySession).toHaveBeenCalled();
    expect(res.headers.get("Location")).toBe("/login");
  });

  it("ends the server session before clearing the cookie", async () => {
    const order: string[] = [];
    const context = contextFor({ refreshToken: "refresh-1" });
    vi.mocked(endSessionByRefreshToken).mockImplementation(async () => {
      order.push("end-session");
    });
    context.destroySession.mockImplementation(() => {
      order.push("destroy-cookie");
    });

    await logout({}, context);

    expect(order).toEqual(["end-session", "destroy-cookie"]);
  });

  it("only clears the cookie when the browser is not signed in", async () => {
    const context = contextFor(null);

    await logout({}, context);

    expect(endSessionByRefreshToken).not.toHaveBeenCalled();
    expect(context.getSession).not.toHaveBeenCalled();
    expect(context.destroySession).toHaveBeenCalled();
  });
});

describe("logout redirect", () => {
  it("goes to the login page by default", async () => {
    expect(await logoutRedirect({})).toBe("/login");
  });

  it("follows a path on this app", async () => {
    expect(await logoutRedirect({ redirectTo: "/sso-login" })).toBe(
      "/sso-login"
    );
  });

  it.each([
    "https://evil.example/login",
    "//evil.example/login",
    "/\\evil.example/login",
  ])("goes to the login page instead of %s", async (redirectTo) => {
    expect(await logoutRedirect({ redirectTo })).toBe("/login");
  });
});
