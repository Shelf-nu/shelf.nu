// @vitest-environment node
/**
 * The logout action follows a `redirectTo` from the form only when it stays
 * on this app, so a cross-site form cannot sign a person out and send them to
 * another site.
 *
 * @see {@link file://./../../../app/routes/_auth+/logout.tsx}
 */
import { createActionArgs } from "@mocks/remix";
import { describe, expect, it, vi } from "vitest";

// why: the route imports cookie helpers that pull the Prisma client
// transitively; logout reads nothing from the database.
vi.mock("~/database/db.server", () => ({ db: {} }));

const { action } = await import("~/routes/_auth+/logout");

/**
 * Posts the logout form and returns where the response redirects.
 *
 * @param fields - The form fields
 */
async function logoutRedirect(fields: Record<string, string>) {
  const result = (await action(
    createActionArgs({
      request: new Request("http://localhost/logout", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(fields),
      }),
      context: { destroySession: vi.fn() } as never,
    })
  )) as Response;
  return result.headers.get("Location");
}

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
