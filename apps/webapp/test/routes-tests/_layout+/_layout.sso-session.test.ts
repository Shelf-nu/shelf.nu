/**
 * App layout loader: the SSO guard on sessions that are already open.
 *
 * A session opened by password or OTP keeps working after its address starts
 * being refused (a domain newly configured for SSO, a deploy). The layout
 * loader ends such a session and sends the person to `/login`, which explains
 * why. SSO users are never asked: their session came from SSO.
 *
 * The non-refused cases use a user who has not onboarded, so the loader stops
 * at the onboarding redirect right after the guard without needing the
 * organization and subscription machinery.
 *
 * @see {@link file://./../../../app/routes/_layout+/_layout.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getLegacyLoginDecision } from "~/modules/auth/sso-enforcement.server";
import { getUserByID } from "~/modules/user/service.server";
import { loader } from "~/routes/_layout+/_layout";

// @vitest-environment node

// why: the decision has its own tests (sso-enforcement.server.test.ts); here
// only what the loader does with its answer matters.
vi.mock("~/modules/auth/sso-enforcement.server", () => ({
  getLegacyLoginDecision: vi.fn(),
}));

// why: supplies the signed-in user row, the input the guard reads.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn(),
}));

// why: importing the route loads ~/database/db.server, whose module-level
// connect rejects in a DB-less test env; nothing here reaches a query.
vi.mock("~/database/db.server", () => ({ db: {} }));

// why: the per-page cookie is parsed alongside the user fetch and is
// irrelevant to the guard.
vi.mock("~/utils/cookies.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/utils/cookies.server")>();
  return {
    ...actual,
    initializePerPageCookieOnLayout: vi.fn().mockResolvedValue({}),
  };
});

/** The user row the loader selects, as a non-onboarded standard account. */
const USER = {
  id: "user-1",
  email: "member@sso-corp.com",
  onboarded: false,
  customerId: null,
  sso: false,
  roles: [],
  userOrganizations: [],
};

/** Runs the loader for a signed-in user, returning the response and context. */
async function load() {
  const destroySession = vi.fn();
  const response = (await loader({
    request: new Request("https://app.shelf.nu/assets"),
    params: {},
    context: {
      getSession: () => ({ userId: "user-1", email: USER.email }),
      destroySession,
    },
  } as unknown as Parameters<typeof loader>[0])) as Response;
  return { response, destroySession };
}

describe("_layout loader SSO session guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLegacyLoginDecision).mockResolvedValue({ allowed: true });
  });

  it("signs out a non-SSO user whose address must now use SSO", async () => {
    vi.mocked(getUserByID).mockResolvedValue(USER as never);
    vi.mocked(getLegacyLoginDecision).mockResolvedValue({
      allowed: false,
      reason: "sso_domain",
    });

    const { response, destroySession } = await load();

    expect(getLegacyLoginDecision).toHaveBeenCalledWith("member@sso-corp.com");
    expect(destroySession).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login?sso_required=true");
  });

  it("keeps the session of an allowed non-SSO user", async () => {
    vi.mocked(getUserByID).mockResolvedValue(USER as never);

    const { response, destroySession } = await load();

    expect(getLegacyLoginDecision).toHaveBeenCalledWith("member@sso-corp.com");
    expect(destroySession).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe("/onboarding");
  });

  it("does not ask the decision for an SSO user", async () => {
    vi.mocked(getUserByID).mockResolvedValue({ ...USER, sso: true } as never);

    const { response, destroySession } = await load();

    expect(getLegacyLoginDecision).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
    expect(response.headers.get("Location")).toBe("/onboarding");
  });
});
