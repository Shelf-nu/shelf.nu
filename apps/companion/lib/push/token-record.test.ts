/**
 * Tests for the push registration record.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo or `@/` paths.
 *
 * @see ./token-record.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isBackingOff,
  isRegistrationCurrent,
  parsePushTokenRecord,
  registrationStatus,
  retryDelay,
  withFailure,
  withoutFailure,
  withRegistration,
  type PushFailure,
  type PushRegistration,
  type PushTokenRecord,
} from "./token-record";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const SENT_AT = 1_700_000_000_000;

const REGISTRATION: PushRegistration = {
  token: "ExponentPushToken[abc]",
  deviceToken: "apns-1",
  userId: "user_1",
  baseUrl: "https://app.shelf.nu",
  sentAt: SENT_AT,
};

const RECORD: PushTokenRecord = {
  registration: REGISTRATION,
  lastFailure: null,
};

const SAME_PERSON = { userId: "user_1", baseUrl: "https://app.shelf.nu" };

const TOKEN_FAILURE: PushFailure = {
  stage: "token",
  at: SENT_AT + HOUR,
  count: 1,
  serverLacksPush: false,
  userId: "user_1",
  baseUrl: "https://app.shelf.nu",
};

test("a stored record round-trips through JSON", () => {
  assert.deepEqual(parsePushTokenRecord(JSON.stringify(RECORD)), RECORD);
  const failed = { registration: null, lastFailure: TOKEN_FAILURE };
  assert.deepEqual(parsePushTokenRecord(JSON.stringify(failed)), failed);
});

test("anything other than a well-formed record parses to null", () => {
  for (const raw of [
    null,
    "",
    "not json",
    "null",
    '"ExponentPushToken[abc]"',
    JSON.stringify(REGISTRATION),
    JSON.stringify({ registration: null, lastFailure: null }),
  ]) {
    assert.equal(parsePushTokenRecord(raw), null, String(raw));
  }
});

test("a malformed half of a record is dropped and the other half kept", () => {
  assert.deepEqual(
    parsePushTokenRecord(
      JSON.stringify({
        registration: { ...REGISTRATION, token: "" },
        lastFailure: TOKEN_FAILURE,
      })
    ),
    { registration: null, lastFailure: TOKEN_FAILURE }
  );
  assert.deepEqual(
    parsePushTokenRecord(
      JSON.stringify({
        registration: REGISTRATION,
        lastFailure: { ...TOKEN_FAILURE, stage: "somewhere" },
      })
    ),
    RECORD
  );
});

test("the same person on the same server within a day needs no new request", () => {
  assert.equal(
    isRegistrationCurrent(RECORD, SAME_PERSON, SENT_AT + 23 * HOUR),
    true
  );
  assert.equal(
    isRegistrationCurrent(
      RECORD,
      { ...SAME_PERSON, deviceToken: "apns-1" },
      SENT_AT + HOUR
    ),
    true
  );
});

test("a registration a day old is sent again", () => {
  assert.equal(
    isRegistrationCurrent(RECORD, SAME_PERSON, SENT_AT + 24 * HOUR),
    false
  );
});

test("a new device token from the OS is sent again at once", () => {
  assert.equal(
    isRegistrationCurrent(
      RECORD,
      { ...SAME_PERSON, deviceToken: "apns-2" },
      SENT_AT + HOUR
    ),
    false
  );
});

test("another person, or another server, registers again at once", () => {
  assert.equal(
    isRegistrationCurrent(
      RECORD,
      { ...SAME_PERSON, userId: "user_2" },
      SENT_AT + HOUR
    ),
    false
  );
  assert.equal(
    isRegistrationCurrent(
      RECORD,
      { ...SAME_PERSON, baseUrl: "https://shelf.acme.edu" },
      SENT_AT + HOUR
    ),
    false
  );
});

test("a failure after the registration means it is no longer current", () => {
  assert.equal(
    isRegistrationCurrent(
      { registration: REGISTRATION, lastFailure: TOKEN_FAILURE },
      SAME_PERSON,
      SENT_AT + 2 * HOUR
    ),
    false
  );
});

test("no record, or one dated in the future, is not current", () => {
  assert.equal(isRegistrationCurrent(null, SAME_PERSON, SENT_AT), false);
  assert.equal(
    isRegistrationCurrent(RECORD, SAME_PERSON, SENT_AT - HOUR),
    false
  );
});

test("the wait after a failure grows 1 min, 5 min, 30 min, then stays at 6 h", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 12].map((count) => retryDelay({ ...TOKEN_FAILURE, count })),
    [MINUTE, 5 * MINUTE, 30 * MINUTE, 6 * HOUR, 6 * HOUR, 6 * HOUR]
  );
});

test("a server without the push route waits a day, from the first failure", () => {
  assert.equal(
    retryDelay({ ...TOKEN_FAILURE, stage: "register", serverLacksPush: true }),
    24 * HOUR
  );
});

test("a run inside the wait is skipped, and one after it goes ahead", () => {
  const record = { registration: null, lastFailure: TOKEN_FAILURE };
  assert.equal(
    isBackingOff(record, SAME_PERSON, TOKEN_FAILURE.at + 59 * 1000),
    true
  );
  assert.equal(
    isBackingOff(record, SAME_PERSON, TOKEN_FAILURE.at + MINUTE),
    false
  );
});

test("a failure for another person or server does not hold this one back", () => {
  const record = { registration: null, lastFailure: TOKEN_FAILURE };
  const soon = TOKEN_FAILURE.at + 1000;
  assert.equal(
    isBackingOff(record, { ...SAME_PERSON, userId: "user_2" }, soon),
    false
  );
  assert.equal(
    isBackingOff(
      record,
      { ...SAME_PERSON, baseUrl: "https://shelf.acme.edu" },
      soon
    ),
    false
  );
  assert.equal(isBackingOff(null, SAME_PERSON, soon), false);
});

test("a failure dated in the future does not block anything", () => {
  const record = { registration: null, lastFailure: TOKEN_FAILURE };
  assert.equal(isBackingOff(record, SAME_PERSON, TOKEN_FAILURE.at - 1), false);
});

test("consecutive failures count up, and keep the registration they follow", () => {
  const first = withFailure(RECORD, {
    stage: "token",
    at: SENT_AT + HOUR,
    serverLacksPush: false,
    ...SAME_PERSON,
  });
  assert.deepEqual(first, {
    registration: REGISTRATION,
    lastFailure: TOKEN_FAILURE,
  });
  const second = withFailure(first, {
    stage: "register",
    at: SENT_AT + 2 * HOUR,
    serverLacksPush: false,
    ...SAME_PERSON,
  });
  assert.deepEqual(second.lastFailure, {
    ...TOKEN_FAILURE,
    stage: "register",
    at: SENT_AT + 2 * HOUR,
    count: 2,
  });
});

test("a failure for another person or server starts the count again", () => {
  const record = {
    registration: null,
    lastFailure: { ...TOKEN_FAILURE, count: 3 },
  };
  assert.equal(
    withFailure(record, {
      stage: "token",
      at: SENT_AT + 2 * HOUR,
      serverLacksPush: false,
      ...SAME_PERSON,
      userId: "user_2",
    }).lastFailure?.count,
    1
  );
});

test("a success replaces the registration and clears the failure", () => {
  const next: PushRegistration = {
    ...REGISTRATION,
    deviceToken: "apns-2",
    sentAt: SENT_AT + 3 * HOUR,
  };
  assert.deepEqual(withRegistration(next), {
    registration: next,
    lastFailure: null,
  });
});

test("forgetting a failure keeps the registration, and leaves nothing without one", () => {
  assert.deepEqual(
    withoutFailure({ registration: REGISTRATION, lastFailure: TOKEN_FAILURE }),
    RECORD
  );
  assert.equal(
    withoutFailure({ registration: null, lastFailure: TOKEN_FAILURE }),
    null
  );
});

test("the registration status speaks for this person on this server only", () => {
  assert.equal(registrationStatus(RECORD, SAME_PERSON), "registered");
  assert.equal(
    registrationStatus(
      { registration: REGISTRATION, lastFailure: TOKEN_FAILURE },
      SAME_PERSON
    ),
    "failed"
  );
  assert.equal(
    registrationStatus(RECORD, { ...SAME_PERSON, userId: "user_2" }),
    "none"
  );
  assert.equal(
    registrationStatus(
      { registration: null, lastFailure: TOKEN_FAILURE },
      { ...SAME_PERSON, baseUrl: "https://shelf.acme.edu" }
    ),
    "none"
  );
  assert.equal(registrationStatus(null, SAME_PERSON), "none");
});
