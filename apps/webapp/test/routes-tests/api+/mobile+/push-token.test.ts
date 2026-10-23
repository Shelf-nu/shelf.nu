// @vitest-environment node
/**
 * Route tests for POST and DELETE /api/mobile/push-token.
 *
 * Pins the device-ownership rules the companion relies on: only a signed-in
 * caller may register, a token must look like an Expo token, a token moves to
 * whoever registers it last, and nobody can forget a token that is not theirs.
 *
 * @see {@link file://../../../../app/routes/api+/mobile+/push-token.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pushStore,
  resetPushStore,
  seedPushToken,
} from "@helpers/in-memory-push-db";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { action } from "~/routes/api+/mobile+/push-token";

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

// why: no database in route tests; the in-memory store enforces the unique
// token the way Postgres does
vi.mock("~/database/db.server", async () => ({
  db: (await import("@helpers/in-memory-push-db")).pushDb,
}));

const TOKEN = "ExponentPushToken[device-1]";

/** Sends `body` to the route as `userId`, or with no bearer when null. */
async function call(method: string, body: unknown, userId: string | null) {
  if (userId) {
    vi.mocked(requireMobileAuth).mockResolvedValueOnce({
      user: { id: userId },
    } as never);
  }
  const response = (await action({
    request: new Request("http://localhost/api/mobile/push-token", {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(userId ? { Authorization: "Bearer test" } : {}),
      },
      body: JSON.stringify(body),
    }),
    params: {},
    context: {},
  } as never)) as unknown as Response;
  return { status: response.status, body: await response.json() };
}

describe("POST /api/mobile/push-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPushStore();
  });

  it("answers 401 without a bearer token and stores nothing", async () => {
    const result = await call("POST", { token: TOKEN, platform: "IOS" }, null);

    expect(result.status).toBe(401);
    expect(pushStore.pushTokens).toEqual([]);
  });

  it("answers 400 for a token that is not an Expo push token", async () => {
    const result = await call(
      "POST",
      { token: "fcm-raw-token", platform: "IOS" },
      "user-a"
    );

    expect(result).toEqual({
      status: 400,
      body: { error: { message: "Expected an Expo push token." } },
    });
    expect(pushStore.pushTokens).toEqual([]);
  });

  it("accepts the newer ExpoPushToken[...] form", async () => {
    const token = "ExpoPushToken[device-2]";

    const result = await call("POST", { token, platform: "ANDROID" }, "user-a");

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token, userId: "user-a" }),
    ]);
  });

  it("moves a token registered by user A to user B", async () => {
    await call("POST", { token: TOKEN, platform: "IOS" }, "user-a");

    const result = await call(
      "POST",
      { token: TOKEN, platform: "IOS", deviceName: null, appVersion: "1.7.0" },
      "user-b"
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({
        token: TOKEN,
        userId: "user-b",
        appVersion: "1.7.0",
      }),
    ]);
  });
});

describe("DELETE /api/mobile/push-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPushStore();
  });

  it("answers 404 and keeps the row when the token belongs to someone else", async () => {
    seedPushToken({ token: TOKEN, userId: "user-b" });

    const result = await call("DELETE", { token: TOKEN }, "user-a");

    expect(result).toEqual({
      status: 404,
      body: { error: { message: "Push token not found." } },
    });
    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: TOKEN, userId: "user-b" }),
    ]);
  });

  it("removes the caller token", async () => {
    seedPushToken({ token: TOKEN, userId: "user-a" });

    const result = await call("DELETE", { token: TOKEN }, "user-a");

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(pushStore.pushTokens).toEqual([]);
  });

  it("answers 400 for a token that is not an Expo push token", async () => {
    const result = await call("DELETE", { token: "fcm-raw-token" }, "user-a");

    expect(result).toEqual({
      status: 400,
      body: { error: { message: "Expected an Expo push token." } },
    });
  });
});

describe("other methods on /api/mobile/push-token", () => {
  it("answers 405 naming the method it received", async () => {
    const result = await call("PATCH", { token: TOKEN }, "user-a");

    expect(result).toEqual({
      status: 405,
      body: { error: { message: '"PATCH" method is not allowed.' } },
    });
  });
});
