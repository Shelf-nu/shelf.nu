/**
 * Tests for the multipart upload request.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./multipart-upload.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { postMultipart } from "./multipart-upload";

/** What a fake request records, and the hooks the test fires on it. */
type SentRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string>;
  body?: unknown;
  opened: boolean;
  aborted: boolean;
  status: number;
  responseText: string;
  onload?: () => void;
  onerror?: () => void;
};

/**
 * Builds a stand-in for the XMLHttpRequest class that records what it was
 * asked to send. The test then settles the request by firing one of its hooks.
 * Like the real one, it refuses headers and a body before `open`.
 *
 * why: Node has no XMLHttpRequest, and the real one needs a device and a
 * server.
 */
function fakeXhr() {
  const sent: SentRequest = {
    headers: {},
    opened: false,
    aborted: false,
    status: 0,
    responseText: "",
  };
  const requireOpened = () => {
    if (!sent.opened) throw new Error("Request has not been opened");
  };
  class FakeXhr {
    constructor() {
      return sent as unknown as FakeXhr;
    }
  }
  Object.assign(sent, {
    open(method: string, url: string) {
      sent.method = method;
      sent.url = url;
      sent.opened = true;
    },
    setRequestHeader(name: string, value: string) {
      requireOpened();
      sent.headers[name] = value;
    },
    send(body: unknown) {
      requireOpened();
      sent.body = body;
    },
    abort() {
      sent.aborted = true;
    },
  });
  return { Xhr: FakeXhr as unknown as typeof XMLHttpRequest, sent };
}

/** A form holding one React Native file part, as the upload callers build it. */
function photoForm() {
  const form = new FormData();
  const file = {
    uri: "file:///tmp/photo.jpg",
    type: "image/jpeg",
    name: "photo.jpg",
  };
  // React Native's FormData takes this object as a file; Node's wants a Blob.
  form.append("mainImage", file as unknown as Blob);
  return form;
}

test("posts the form itself, so a file part reaches the platform as given", async () => {
  const { Xhr, sent } = fakeXhr();
  const form = photoForm();

  const pending = postMultipart(
    "https://shelf.test/api/mobile/asset/update-image?assetId=a1",
    {
      headers: { Authorization: "Bearer token-1", "User-Agent": "Shelf/1.8.0" },
      body: form,
      timeoutMs: 80_000,
    },
    Xhr
  );
  sent.status = 200;
  sent.responseText = '{"asset":{"id":"a1"}}';
  sent.onload?.();

  assert.deepEqual(await pending, {
    status: 200,
    ok: true,
    text: '{"asset":{"id":"a1"}}',
  });
  assert.equal(sent.method, "POST");
  assert.equal(
    sent.url,
    "https://shelf.test/api/mobile/asset/update-image?assetId=a1"
  );
  assert.equal(sent.body, form);
  // No Content-Type: the platform writes it, with the multipart boundary.
  assert.deepEqual(sent.headers, {
    Authorization: "Bearer token-1",
    "User-Agent": "Shelf/1.8.0",
  });
});

test("an error status resolves with its body, for the caller to read", async () => {
  const { Xhr, sent } = fakeXhr();

  const pending = postMultipart(
    "https://shelf.test/upload",
    { headers: {}, body: photoForm(), timeoutMs: 1000 },
    Xhr
  );
  sent.status = 403;
  sent.responseText = '{"error":{"message":"Not allowed"}}';
  sent.onload?.();

  assert.deepEqual(await pending, {
    status: 403,
    ok: false,
    text: '{"error":{"message":"Not allowed"}}',
  });
});

test("a request still running at the time limit is aborted as an AbortError", async (t) => {
  // why: the limit is 80 seconds on a device; the test must not wait for it.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { Xhr, sent } = fakeXhr();

  const pending = postMultipart(
    "https://shelf.test/upload",
    { headers: {}, body: photoForm(), timeoutMs: 80_000 },
    Xhr
  );
  t.mock.timers.tick(79_999);
  assert.equal(sent.aborted, false);
  t.mock.timers.tick(1);

  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(sent.aborted, true);
});

test("a finished request is not aborted when the time limit passes", async (t) => {
  // why: the limit is 80 seconds on a device; the test must not wait for it.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { Xhr, sent } = fakeXhr();

  const pending = postMultipart(
    "https://shelf.test/upload",
    { headers: {}, body: photoForm(), timeoutMs: 80_000 },
    Xhr
  );
  sent.status = 200;
  sent.onload?.();
  await pending;
  t.mock.timers.tick(80_000);

  assert.equal(sent.aborted, false);
});

test("a request that never gets a response rejects as a network failure", async () => {
  const { Xhr, sent } = fakeXhr();

  const pending = postMultipart(
    "https://shelf.test/upload",
    { headers: {}, body: photoForm(), timeoutMs: 1000 },
    Xhr
  );
  sent.onerror?.();

  await assert.rejects(pending, {
    name: "TypeError",
    message: "Network request failed",
  });
});
