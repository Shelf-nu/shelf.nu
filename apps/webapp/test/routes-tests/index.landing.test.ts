/**
 * `/` sends a signed-in member to their role's landing page.
 *
 * @see {@link file://../../app/routes/_index.tsx}
 */
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLoaderArgs } from "@mocks/remix";

const state = vi.hoisted(() => ({ roles: ["ADMIN"] as string[], fail: false }));

// why: the membership read needs the session cookie and the database
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: vi.fn(async () => {
    if (state.fail) throw new Error("no organization yet");
    return {
      organizationId: "org-1",
      userOrganizations: [
        { organization: { id: "org-1" }, roles: state.roles },
      ],
    };
  }),
}));

const { loader } = await import("~/routes/_index");

const run = (isAuthenticated: boolean) =>
  loader(
    createLoaderArgs({
      request: new Request("http://localhost/"),
      context: {
        isAuthenticated,
        getSession: () => ({ userId: "u" }),
      } as never,
    })
  ) as unknown as Promise<Response>;

describe("/ landing", () => {
  it.each([["OWNER"], ["ADMIN"], ["SELF_SERVICE"], ["BASE"]])(
    "%s lands on /assets",
    async (role) => {
      state.roles = [role];
      state.fail = false;
      expect((await run(true)).headers.get("Location")).toBe("/assets");
    }
  );

  it("falls back to /assets when the membership cannot be read (onboarding)", async () => {
    state.fail = true;
    expect((await run(true)).headers.get("Location")).toBe("/assets");
  });

  it("sends anonymous visitors to /login", async () => {
    expect((await run(false)).headers.get("Location")).toBe("/login");
  });
});
