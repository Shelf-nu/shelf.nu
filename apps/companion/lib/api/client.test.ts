/**
 * Tests for the access-token cache: a session read that spans the end of a
 * session, or a change of account, is never cached or used, while a token
 * refresh for the same account is.
 *
 * @see {@link file://./client.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";

// why: React Native defines `__DEV__`; the request path logs behind it.
(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;

/** The fake client's auth listener and pending session reads. */
const auth = {
  listener: null as null | ((event: string, session: unknown) => void),
  reads: [] as ((token: string | null, error?: Error) => void)[],
  readCount: 0,
};

/**
 * Resolves the oldest pending session read with this access token, and the
 * error supabase-js reports when its own refresh failed.
 */
function answerRead(token: string | null, error?: Error) {
  auth.reads.shift()!(token, error);
}

/** An auth event as supabase-js delivers it. */
function emit(event: string, userId: string | null) {
  auth.listener!(event, userId ? { user: { id: userId } } : null);
}

// why: the Supabase client reads SecureStore; the fake holds each session
// read open until the test answers it, so a sign-out can land in between.
mock.module(pathToFileURL(join(__dirname, "..", "supabase.ts")).href, {
  namedExports: {
    getSupabase: () => ({
      auth: {
        onAuthStateChange: (
          listener: (event: string, session: unknown) => void
        ) => {
          auth.listener = listener;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getSession: () => {
          auth.readCount += 1;
          return new Promise((resolve) => {
            auth.reads.push((token, error) =>
              resolve({
                data: { session: token ? { access_token: token } : null },
                error: error ?? null,
              })
            );
          });
        },
      },
    }),
    getSupabaseClientUrl: () => "https://project.supabase.test",
  },
});

// why: the active server module loads AsyncStorage and Expo config; the fake
// pins one server that never changes during these tests.
mock.module(
  pathToFileURL(join(__dirname, "..", "server", "active-server.ts")).href,
  {
    namedExports: {
      getActiveServer: () => ({
        baseUrl: "https://app.shelf.test",
        supabaseUrl: "https://project.supabase.test",
      }),
      getServerVersion: () => 1,
      subscribeToServerChange: () => () => {},
    },
  }
);

// why: Sentry is native; mismatch reports are not under test here.
mock.module(pathToFileURL(join(__dirname, "..", "sentry.ts")).href, {
  namedExports: { reportServerMismatch: () => {} },
});

// why: the user-agent string reads expo-constants (native).
mock.module(pathToFileURL(join(__dirname, "user-agent.ts")).href, {
  namedExports: { CLIENT_USER_AGENT: "shelf-companion-test" },
});

let client: typeof import("./client");
let sessionEnd: typeof import("../server/session-end");

before(async () => {
  client = await import("./client");
  sessionEnd = await import("../server/session-end");
});

beforeEach(() => {
  auth.reads.length = 0;
  auth.readCount = 0;
  // Start every test from a fresh, signed-in account with an empty cache.
  sessionEnd.runAfterSessionEnd();
  emit("SIGNED_IN", "user_a");
});

describe("getAccessToken", () => {
  it("caches a token read for the signed-in account", async () => {
    const first = client.getAccessToken();
    answerRead("token-a");
    assert.equal(await first, "token-a");

    assert.equal(await client.getAccessToken(), "token-a");
    assert.equal(auth.readCount, 1);
  });

  it("drops a read that was in flight when a session ended", async () => {
    const pending = client.getAccessToken();
    sessionEnd.runAfterSessionEnd(); // a forced sign-out: no auth event
    answerRead("token-a");

    assert.equal(await pending, null);
    const next = client.getAccessToken();
    assert.equal(auth.readCount, 2); // nothing was cached
    answerRead(null);
    await next;
  });

  it("drops a read that was in flight when another account signed in", async () => {
    const pending = client.getAccessToken();
    emit("SIGNED_IN", "user_b");
    answerRead("token-a");

    assert.equal(await pending, null);
  });

  it("keeps a read across a token refresh for the same account", async () => {
    const pending = client.getAccessToken();
    emit("TOKEN_REFRESHED", "user_a");
    answerRead("token-a2");

    assert.equal(await pending, "token-a2");
  });
});

describe("apiFetch when the account changes during the token read", () => {
  it("returns a session-changed error and does not report an expired session", async () => {
    let authErrors = 0;
    const unregister = client.onAuthError(() => {
      authErrors += 1;
    });

    const request = client.apiFetch("/api/mobile/dashboard?orgId=org_1");
    emit("SIGNED_IN", "user_b"); // another person signed in meanwhile
    answerRead("token-a");
    const result = await request;
    unregister();

    assert.equal(result.data, null);
    assert.equal(result.error, "Your session changed. Please try again.");
    assert.equal(authErrors, 0);
  });
});

describe("a read whose own refresh ends the session", () => {
  it("is reported as an expired session, not a changed one", async () => {
    let authErrors = 0;
    const unregister = client.onAuthError(() => {
      authErrors += 1;
    });

    const request = client.apiFetch("/api/mobile/dashboard?orgId=org_1");
    emit("SIGNED_OUT", null); // the refresh inside getSession failed
    answerRead(null, new Error("Invalid Refresh Token"));
    const result = await request;
    unregister();

    assert.equal(result.error, "Session expired. Please sign in again.");
    assert.equal(authErrors, 1);
  });
});

describe("a sign-out that lands during the token read", () => {
  it("is reported as a changed session, not an expired one", async () => {
    let authErrors = 0;
    const unregister = client.onAuthError(() => {
      authErrors += 1;
    });

    const request = client.apiFetch("/api/mobile/dashboard?orgId=org_1");
    emit("SIGNED_OUT", null); // the person tapped Sign out
    answerRead(null);
    const result = await request;
    unregister();

    assert.equal(result.error, "Your session changed. Please try again.");
    assert.equal(authErrors, 0);
  });
});

describe("apiFetch's automatic retry", () => {
  it("is not sent when another account signed in during the first attempt", async () => {
    const realFetch = globalThis.fetch;
    let sends = 0;
    // why: the network is the boundary under test; the first attempt fails
    // with a network error after another person signed in on the phone.
    globalThis.fetch = (async () => {
      sends += 1;
      emit("SIGNED_IN", "user_b");
      throw new TypeError("Network request failed");
    }) as typeof fetch;
    try {
      const request = client.apiFetch("/api/mobile/audits/record-scan?orgId=o");
      answerRead("token-a");
      const result = await request;

      assert.equal(result.error, "Your session changed. Please try again.");
      assert.equal(sends, 1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
