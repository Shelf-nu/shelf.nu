/**
 * Tests for the push registrar: registration runs, sign-out, backoff and
 * failure reporting, against a fake phone.
 *
 * The fake stands in for the boundary only (storage, the OS, Expo, the Shelf
 * server, Sentry); every decision under test is the registrar's own.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./registrar.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPushRegistrar,
  type PushApiAnswer,
  type PushSession,
  type RegistrarEffects,
} from "./registrar";
import type { PushPermission } from "./preferences";
import type { PushFailureStage, PushTokenRecord } from "./token-record";

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;
const BASE_URL = "https://app.shelf.nu";
const TOKEN = "ExponentPushToken[new]";
const OLD_TOKEN = "ExponentPushToken[old]";

/** A promise with its settle functions, to hold a step open. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued promise callback run. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** A registration this phone made a day and a bit ago, so a run proceeds. */
const STALE_RECORD: PushTokenRecord = {
  registration: {
    token: OLD_TOKEN,
    deviceToken: "apns-old",
    userId: "user_1",
    baseUrl: BASE_URL,
    sentAt: NOW - 25 * HOUR,
  },
  lastFailure: null,
};

/** {@link STALE_RECORD} after a sign-out whose DELETE went unconfirmed. */
const UNCONFIRMED_RECORD: PushTokenRecord = {
  ...STALE_RECORD,
  registration: { ...STALE_RECORD.registration!, removalUnconfirmed: true },
};

/** The boundary's state and what the registrar did to it. */
type Phone = {
  session: PushSession | null;
  record: PushTokenRecord | null;
  optedIn: boolean;
  permission: PushPermission | Error;
  now: number;
  /** Replaces the token step; by default it answers at once. */
  fetchTokens: (signal: AbortSignal) => Promise<{
    token: string;
    deviceToken: string;
  }>;
  postAnswer: (token: string, signal: AbortSignal) => Promise<PushApiAnswer>;
  deleteAnswer: (signal: AbortSignal) => Promise<PushApiAnswer>;
  posts: string[];
  deletes: string[];
  reports: [PushFailureStage, string][];
  /** Every effect call, in order, for the tests that care about sequence. */
  calls: string[];
};

/** A signed-in, opted-in phone with permission, and its effects. */
function fakePhone(overrides: Partial<Phone> = {}) {
  const phone: Phone = {
    session: { userId: "user_1", accessToken: "access-1" },
    record: null,
    optedIn: true,
    permission: "granted",
    now: NOW,
    fetchTokens: async () => ({ token: TOKEN, deviceToken: "apns-new" }),
    postAnswer: async () => ({ kind: "ok" }),
    deleteAnswer: async () => ({ kind: "ok" }),
    posts: [],
    deletes: [],
    reports: [],
    calls: [],
    ...overrides,
  };
  const effects: RegistrarEffects<string> = {
    getSession: async () => phone.session,
    getBaseUrl: () => BASE_URL,
    readRecord: async () => phone.record,
    writeRecord: async (record) => {
      phone.calls.push(record ? "write-record" : "remove-record");
      phone.record = record;
    },
    readOptedIn: async () => phone.optedIn,
    readPermission: async () => {
      if (phone.permission instanceof Error) throw phone.permission;
      return phone.permission;
    },
    deviceTokenOf: (reported) => reported,
    fetchTokens: (_reported, signal) => {
      phone.calls.push("fetch-tokens");
      return phone.fetchTokens(signal);
    },
    postToken: (token, signal) => {
      phone.calls.push("post");
      phone.posts.push(token);
      return phone.postAnswer(token, signal);
    },
    deleteToken: (token, signal) => {
      phone.calls.push("delete");
      phone.deletes.push(token);
      return phone.deleteAnswer(signal);
    },
    report: (stage, message) => {
      phone.reports.push([stage, message]);
    },
    now: () => phone.now,
  };
  return { phone, effects };
}

/** A token step that answers only when the run is aborted, by rejecting. */
function tokenStepUntilAborted(phone: Phone) {
  const started = deferred<void>();
  phone.fetchTokens = (signal) =>
    new Promise((_, reject) => {
      started.resolve();
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  return started.promise;
}

/**
 * A POST that honours its abort signal the way `fetch` does: once aborted it
 * answers `aborted` and never reaches the server. `apply` makes the server
 * apply it, and `answer` delivers the server's answer.
 */
function postOnTheWire(phone: Phone) {
  const applied: string[] = [];
  const answered = deferred<void>();
  const sent: { token: string; signal: AbortSignal | null } = {
    token: "",
    signal: null,
  };
  phone.postAnswer = (token, signal) =>
    new Promise((resolve) => {
      sent.token = token;
      sent.signal = signal;
      signal.addEventListener("abort", () => resolve({ kind: "aborted" }));
      void answered.promise.then(() => resolve({ kind: "ok" }));
    });
  return {
    applied,
    apply: () => {
      if (!sent.signal?.aborted) applied.push(sent.token);
    },
    answer: () => answered.resolve(),
  };
}

test("an opted-in phone registers and remembers what it sent", async () => {
  const { phone, effects } = fakePhone();
  const registrar = createPushRegistrar(effects);

  assert.equal(await registrar.register(), "registered");
  assert.deepEqual(phone.posts, [TOKEN]);
  assert.deepEqual(phone.record, {
    registration: {
      token: TOKEN,
      deviceToken: "apns-new",
      userId: "user_1",
      baseUrl: BASE_URL,
      sentAt: NOW,
    },
    lastFailure: null,
  });
});

test("a phone that never opted in registers nothing in the background", async () => {
  const { phone, effects } = fakePhone({ optedIn: false });
  const registrar = createPushRegistrar(effects);

  assert.equal(await registrar.register(), "not-opted-in");
  assert.equal(
    await registrar.register({ reported: "apns-new" }),
    "not-opted-in"
  );
  assert.deepEqual(phone.posts, []);
});

test("the explainer's tap registers before the opt-in flag is read back", async () => {
  const { phone, effects } = fakePhone({ optedIn: false });
  const registrar = createPushRegistrar(effects);

  assert.equal(await registrar.register({ force: true }), "registered");
  assert.deepEqual(phone.posts, [TOKEN]);
});

test("a current registration sends nothing, and a new OS token is sent at once", async () => {
  const { phone, effects } = fakePhone();
  const registrar = createPushRegistrar(effects);
  await registrar.register();

  assert.equal(await registrar.register(), "current");
  assert.equal(await registrar.register({ reported: "apns-new" }), "current");
  assert.equal(await registrar.register({ reported: "apns-2" }), "registered");
  assert.deepEqual(phone.posts, [TOKEN, TOKEN]);
});

test("permission not granted is no failure: nothing is sent or recorded", async () => {
  const { phone, effects } = fakePhone({ permission: "denied" });
  const registrar = createPushRegistrar(effects);

  assert.equal(await registrar.register(), "no-permission");
  assert.deepEqual(phone.posts, []);
  assert.equal(phone.record, null);
  assert.deepEqual(phone.reports, []);
});

test("signing out during the token step sends no POST and forgets the stored token", async () => {
  const { phone, effects } = fakePhone({ record: STALE_RECORD });
  const tokenStep = tokenStepUntilAborted(phone);
  const registrar = createPushRegistrar(effects);

  const run = registrar.register();
  await tokenStep;
  await registrar.unregister();

  assert.equal(await run, "aborted");
  assert.deepEqual(phone.posts, []);
  assert.deepEqual(phone.deletes, [OLD_TOKEN]);
  assert.equal(phone.record, null);
});

test("signing out while the POST is in flight waits for it, then forgets that token", async () => {
  const { phone, effects } = fakePhone();
  const post = deferred<PushApiAnswer>();
  phone.postAnswer = () => post.promise;
  const registrar = createPushRegistrar(effects);

  const run = registrar.register();
  await flush();
  assert.deepEqual(phone.posts, [TOKEN]);

  const signOut = registrar.unregister();
  await flush();
  assert.deepEqual(phone.deletes, [], "no DELETE can overtake the POST");

  post.resolve({ kind: "ok" });
  await signOut;
  assert.equal(await run, "aborted");
  assert.deepEqual(phone.deletes, [TOKEN]);
  assert.deepEqual(phone.calls, [
    "fetch-tokens",
    "post",
    "delete",
    "remove-record",
  ]);
  assert.equal(phone.record, null);
});

test("signing out aborts the POST in flight, so it cannot land after sign-out", async () => {
  const { phone, effects } = fakePhone();
  const wire = postOnTheWire(phone);
  const registrar = createPushRegistrar(effects, { unregisterTimeoutMs: 20 });

  const run = registrar.register();
  await flush();
  assert.deepEqual(phone.posts, [TOKEN]);

  await registrar.unregister();
  wire.apply();
  wire.answer();

  assert.equal(await run, "aborted");
  assert.deepEqual(
    wire.applied,
    [],
    "the aborted POST never reaches the server"
  );
  assert.deepEqual(phone.deletes, [TOKEN]);
  assert.equal(phone.record, null);
  assert.deepEqual(phone.reports, []);
});

test("a POST the server applied before sign-out cut it off is still forgotten", async () => {
  const { phone, effects } = fakePhone();
  const wire = postOnTheWire(phone);
  const registrar = createPushRegistrar(effects, { unregisterTimeoutMs: 20 });

  const run = registrar.register();
  await flush();
  wire.apply();
  await registrar.unregister();

  assert.deepEqual(wire.applied, [TOKEN]);
  assert.deepEqual(
    phone.calls,
    ["fetch-tokens", "post", "delete", "remove-record"],
    "the DELETE follows the applied POST"
  );
  assert.deepEqual(phone.deletes, [TOKEN]);
  assert.equal(phone.record, null);
  assert.equal(await run, "aborted");
});

test("a DELETE the server answers 404 to counts as forgotten", async () => {
  const { phone, effects } = fakePhone({
    record: STALE_RECORD,
    deleteAnswer: async () => ({
      kind: "rejected",
      status: 404,
      message: "Push token not found.",
    }),
  });
  const registrar = createPushRegistrar(effects);

  await registrar.unregister();
  assert.equal(phone.record, null);
  assert.deepEqual(phone.reports, []);
});

test("a failed DELETE keeps the record, marked unconfirmed, and is reported as an unregister failure", async () => {
  const { phone, effects } = fakePhone({
    record: STALE_RECORD,
    deleteAnswer: async () => ({ kind: "unreachable", message: "offline" }),
  });
  const registrar = createPushRegistrar(effects);

  await registrar.unregister();
  assert.deepEqual(phone.record, UNCONFIRMED_RECORD);
  assert.deepEqual(phone.reports, [["unregister", "offline"]]);
});

test("sign-out gives up on a DELETE that never answers, keeping the record marked unconfirmed", async () => {
  const { phone, effects } = fakePhone({
    record: STALE_RECORD,
    deleteAnswer: (signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ kind: "aborted" }));
      }),
  });
  const registrar = createPushRegistrar(effects, { unregisterTimeoutMs: 20 });

  await registrar.unregister();
  await flush();
  assert.deepEqual(phone.record, UNCONFIRMED_RECORD);
});

test("after an unconfirmed sign-out, the same person's next sign-in registers again at once", async () => {
  const { phone, effects } = fakePhone({
    record: {
      ...UNCONFIRMED_RECORD,
      registration: {
        ...UNCONFIRMED_RECORD.registration!,
        token: TOKEN,
        deviceToken: "apns-new",
        sentAt: NOW - HOUR,
      },
    },
    session: { userId: "user_1", accessToken: "access-2" },
  });
  const registrar = createPushRegistrar(effects);

  assert.equal(await registrar.register(), "registered");
  assert.deepEqual(phone.posts, [TOKEN]);
  assert.equal(phone.record?.registration?.removalUnconfirmed, undefined);
});

test("sign-out leaves a registration made on another server alone, even when the active one answers 404", async () => {
  const otherServer: PushTokenRecord = {
    ...STALE_RECORD,
    registration: {
      ...STALE_RECORD.registration!,
      baseUrl: "https://shelf.acme.edu",
    },
  };
  const { phone, effects } = fakePhone({
    record: otherServer,
    deleteAnswer: async () => ({
      kind: "rejected",
      status: 404,
      message: "Push token not found.",
    }),
  });
  const registrar = createPushRegistrar(effects);

  await registrar.unregister();
  assert.deepEqual(phone.deletes, []);
  assert.deepEqual(phone.record, otherServer);
});

test("sign-out leaves another person's registration alone", async () => {
  const otherPerson: PushTokenRecord = {
    ...STALE_RECORD,
    registration: { ...STALE_RECORD.registration!, userId: "user_2" },
  };
  const { phone, effects } = fakePhone({ record: otherPerson });
  const registrar = createPushRegistrar(effects);

  await registrar.unregister();
  assert.deepEqual(phone.deletes, []);
  assert.deepEqual(phone.record, otherPerson);
});

test("the session that signed out never registers again, and the next one does", async () => {
  const { phone, effects } = fakePhone();
  const registrar = createPushRegistrar(effects);

  await registrar.unregister();
  assert.equal(await registrar.register(), "signed-out");
  assert.equal(await registrar.register({ force: true }), "signed-out");
  assert.deepEqual(phone.posts, []);

  phone.session = { userId: "user_1", accessToken: "access-2" };
  assert.equal(await registrar.register(), "registered");
});

test("a registration asked for during sign-out is refused", async () => {
  const { phone, effects } = fakePhone({ record: STALE_RECORD });
  const del = deferred<PushApiAnswer>();
  phone.deleteAnswer = () => del.promise;
  const registrar = createPushRegistrar(effects);

  const signOut = registrar.unregister();
  await flush();
  const run = registrar.register({ reported: "apns-2" });
  del.resolve({ kind: "ok" });
  await signOut;

  assert.equal(await run, "signed-out");
  assert.deepEqual(phone.posts, []);
});

test("each failure is recorded with the stage that failed", async () => {
  const cases: {
    name: string;
    phone: Partial<Phone>;
    stage: PushFailureStage;
  }[] = [
    {
      name: "permission",
      phone: { permission: new Error("permission module crashed") },
      stage: "permission",
    },
    {
      name: "token",
      phone: {
        fetchTokens: async () => {
          throw new Error("no APNs credentials");
        },
      },
      stage: "token",
    },
    {
      name: "register refused",
      phone: {
        postAnswer: async () => ({
          kind: "rejected",
          status: 500,
          message: "Server error (500)",
        }),
      },
      stage: "register",
    },
    {
      name: "register unreachable",
      phone: {
        postAnswer: async () => ({ kind: "unreachable", message: "offline" }),
      },
      stage: "register",
    },
  ];
  for (const { name, phone: overrides, stage } of cases) {
    const { phone, effects } = fakePhone(overrides);
    const registrar = createPushRegistrar(effects);

    assert.equal(await registrar.register(), "failed", name);
    assert.equal(phone.record?.lastFailure?.stage, stage, name);
    assert.equal(phone.record?.lastFailure?.count, 1, name);
    assert.deepEqual(
      phone.reports.map(([reported]) => reported),
      [stage],
      name
    );
  }
});

test("each stage reaches Sentry once per app session", async () => {
  const { phone, effects } = fakePhone({
    fetchTokens: async () => {
      throw new Error("no APNs credentials");
    },
  });
  const registrar = createPushRegistrar(effects);

  await registrar.register({ force: true });
  await registrar.register({ force: true });
  phone.fetchTokens = async () => ({ token: TOKEN, deviceToken: "apns-new" });
  phone.postAnswer = async () => ({ kind: "unreachable", message: "offline" });
  await registrar.register({ force: true });
  await registrar.register({ force: true });

  assert.deepEqual(phone.reports, [
    ["token", "no APNs credentials"],
    ["register", "offline"],
  ]);
});

test("a server without the push route is not reported and is left alone for a day", async () => {
  const { phone, effects } = fakePhone({
    postAnswer: async () => ({
      kind: "rejected",
      status: 404,
      message: "Server error (404)",
    }),
  });
  const registrar = createPushRegistrar(effects);

  assert.equal(await registrar.register(), "failed");
  assert.deepEqual(phone.reports, []);
  assert.equal(phone.record?.lastFailure?.serverLacksPush, true);

  phone.now = NOW + 23 * HOUR;
  assert.equal(await registrar.register(), "backing-off");
  assert.deepEqual(phone.posts, [TOKEN]);
});

test("a run inside the wait is skipped, even for a token the OS just reported", async () => {
  const { phone, effects } = fakePhone({
    postAnswer: async () => ({ kind: "unreachable", message: "offline" }),
  });
  const registrar = createPushRegistrar(effects);
  await registrar.register();

  phone.postAnswer = async () => ({ kind: "ok" });
  phone.now = NOW + 30 * 1000;
  assert.equal(await registrar.register({ reported: "apns-2" }), "backing-off");
  assert.equal(await registrar.register(), "backing-off");

  phone.now = NOW + 60 * 1000;
  assert.equal(await registrar.register(), "registered");
  assert.deepEqual(phone.posts, [TOKEN, TOKEN]);
  assert.equal(phone.record?.lastFailure, null);
});

test("an explicit tap skips the wait, and its failure starts the count at one", async () => {
  const { phone, effects } = fakePhone({
    postAnswer: async () => ({ kind: "unreachable", message: "offline" }),
  });
  const registrar = createPushRegistrar(effects);
  await registrar.register();
  phone.now = NOW + 2 * 60 * 1000;
  await registrar.register();
  assert.equal(phone.record?.lastFailure?.count, 2);

  phone.now = NOW + 3 * 60 * 1000;
  assert.equal(await registrar.register({ force: true }), "failed");
  assert.equal(phone.record?.lastFailure?.count, 1);
});
