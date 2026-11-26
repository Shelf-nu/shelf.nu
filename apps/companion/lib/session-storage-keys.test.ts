/**
 * Tests for the session storage key names.
 *
 * @see ./session-storage-keys.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { sessionStorageKey, sessionStorageKeys } from "./session-storage-keys";

describe("sessionStorageKey", () => {
  it("names the project ref as supabase-js does", () => {
    assert.equal(
      sessionStorageKey("https://abcd1234.supabase.co"),
      "sb-abcd1234-auth-token"
    );
    assert.equal(
      sessionStorageKey("https://abcd1234.supabase.co/"),
      "sb-abcd1234-auth-token"
    );
    assert.equal(
      sessionStorageKey("http://10.0.0.2:54321"),
      "sb-10-auth-token"
    );
  });

  it("matches the default key the installed supabase-js derives", () => {
    const require = createRequire(__filename);
    const { createClient } = require("@supabase/supabase-js") as {
      createClient: (
        url: string,
        key: string,
        options: object
      ) => { auth: unknown };
    };
    const url = "https://abcd1234.supabase.co";
    const client = createClient(url, "anon", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // why: storageKey is protected in the type but present at runtime; it is
    // the value supabase-js uses when no key is passed.
    const derived = (client.auth as { storageKey: string }).storageKey;

    assert.equal(sessionStorageKey(url), derived);
  });
});

describe("sessionStorageKeys", () => {
  it("lists the session, code verifier and user keys", () => {
    assert.deepEqual(sessionStorageKeys("sb-abcd-auth-token"), [
      "sb-abcd-auth-token",
      "sb-abcd-auth-token-code-verifier",
      "sb-abcd-auth-token-user",
    ]);
  });
});
