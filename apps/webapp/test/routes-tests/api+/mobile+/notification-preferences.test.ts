// @vitest-environment node
/**
 * Route tests for GET and PUT /api/mobile/notification-preferences.
 *
 * Pins what the companion settings screen reads and writes: only a signed-in
 * caller gets an answer, all-on defaults for someone who never changed a
 * switch, partial updates that keep the other switches, and a workspace list
 * that names only workspaces whose tier includes push.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/notification-preferences.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pushStore,
  resetPushStore,
  seedMemberships,
  seedOrganization,
  seedPreferences,
} from "@helpers/in-memory-push-db";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { action, loader } from "~/routes/api+/mobile+/notification-preferences";

// why: data() must return a real Response so the tests can read status and body
vi.mock("react-router", async () => ({
  ...(await vi.importActual("react-router")),
  data: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200 }),
}));

// why: a valid bearer token needs Supabase. The real check still runs when a
// test does not stub it, so a request without a bearer meets the real 401.
vi.mock("~/modules/api/mobile-auth.server", async () => {
  const actual = await vi.importActual<
    typeof import("~/modules/api/mobile-auth.server")
  >("~/modules/api/mobile-auth.server");
  return { ...actual, requireMobileAuth: vi.fn(actual.requireMobileAuth) };
});

// why: no database in route tests; the in-memory store holds the preference
// rows, the memberships and the owner tiers the tier check reads
vi.mock("~/database/db.server", async () => ({
  db: (await import("@helpers/in-memory-push-db")).pushDb,
}));

const ENDPOINT = "http://localhost/api/mobile/notification-preferences";

/** Lets the next request carry a valid bearer for `userId`; null sends none. */
function signedInAs(userId: string | null): Record<string, string> {
  if (userId) {
    vi.mocked(requireMobileAuth).mockResolvedValueOnce({
      user: { id: userId },
    } as never);
  }
  return userId ? { Authorization: "Bearer test" } : {};
}

/** Calls the loader as the companion does, as user-1 unless told otherwise. */
async function get(userId: string | null = "user-1") {
  const response = (await loader({
    request: new Request(ENDPOINT, { headers: signedInAs(userId) }),
    params: {},
    context: {},
  } as never)) as unknown as Response;
  return { status: response.status, body: await response.json() };
}

/** Calls the action with a JSON body, as user-1 unless told otherwise. */
async function put(body: unknown, userId: string | null = "user-1") {
  const response = (await action({
    request: new Request(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...signedInAs(userId) },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never)) as unknown as Response;
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPushStore();
  seedOrganization({ id: "org-free", userId: "owner-free" }, "free");
  seedOrganization({ id: "org-plus", userId: "owner-plus" }, "tier_1");
  seedOrganization({ id: "org-team", userId: "owner-team" }, "tier_2");
  seedMemberships("user-1", ["org-free", "org-plus", "org-team"]);
  seedMemberships("user-2", ["org-free"]);
});

describe("GET /api/mobile/notification-preferences", () => {
  it("answers 401 without a bearer token", async () => {
    const result = await get(null);

    expect(result.status).toBe(401);
    expect(result.body.preferences).toBeUndefined();
  });

  it("answers every switch on for someone who never changed one", async () => {
    const result = await get();

    expect(result.status).toBe(200);
    expect(result.body.preferences).toEqual({
      pushEnabled: true,
      bookings: true,
      audits: true,
      stockAndReminders: true,
    });
  });

  it("lists only the workspaces whose tier includes push", async () => {
    const result = await get();

    expect(result.body.organizationsWithPush).toEqual(["org-plus", "org-team"]);
    expect(result.body.pushAvailable).toBe(true);
  });

  it("reports push unavailable when every workspace is on the free tier", async () => {
    const result = await get("user-2");

    expect(result.body.organizationsWithPush).toEqual([]);
    expect(result.body.pushAvailable).toBe(false);
  });
});

describe("PUT /api/mobile/notification-preferences", () => {
  it("answers 401 without a bearer token and saves nothing", async () => {
    const result = await put({ bookings: false }, null);

    expect(result.status).toBe(401);
    expect(pushStore.preferences).toEqual([]);
  });

  it("changes the switches sent and keeps the others", async () => {
    seedPreferences({ userId: "user-1", audits: false });

    const result = await put({ bookings: false });

    const expected = {
      pushEnabled: true,
      bookings: false,
      audits: false,
      stockAndReminders: true,
    };
    expect(result).toEqual({ status: 200, body: { preferences: expected } });
    expect(pushStore.preferences).toEqual([{ userId: "user-1", ...expected }]);
  });

  it("creates the row on the first change", async () => {
    const result = await put({ pushEnabled: false });

    expect(result.body.preferences).toEqual({
      pushEnabled: false,
      bookings: true,
      audits: true,
      stockAndReminders: true,
    });
    expect(pushStore.preferences).toHaveLength(1);
  });

  it("answers 400 and saves nothing for a body with no known switch", async () => {
    const result = await put({ marketing: true });

    expect(result.status).toBe(400);
    expect(pushStore.preferences).toEqual([]);
  });

  it("answers 400 for a switch that is not a boolean", async () => {
    const result = await put({ bookings: "off" });

    expect(result.status).toBe(400);
    expect(pushStore.preferences).toEqual([]);
  });
});
