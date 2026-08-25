/**
 * Tests for the pure server-contract helpers.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths. That
 * constraint is the whole reason the pure logic lives in its own module.
 *
 * @see ./contract.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyServerChange,
  decideServerCandidate,
  decideServerConnection,
  extractEmailDomain,
  isAppVersionSupported,
  isSameOrigin,
  isSessionServerMismatched,
  MAX_SERVER_MOBILE_API_VERSION,
  normalizeBaseUrl,
  normalizeDomainInput,
  parseServerConfigResponse,
  SERVER_SCOPED_KEY_PREFIXES,
  SERVER_SCOPED_STORAGE_KEYS,
} from "./contract";

// ── extractEmailDomain ───────────────────────────────────

test("extractEmailDomain returns the lowercased domain", () => {
  assert.equal(extractEmailDomain("Jane@Acme.EDU"), "acme.edu");
});

test("extractEmailDomain tolerates surrounding whitespace", () => {
  assert.equal(extractEmailDomain("  jane@acme.edu  "), "acme.edu");
});

test("extractEmailDomain handles plus-addressing", () => {
  assert.equal(extractEmailDomain("jane+phone@acme.edu"), "acme.edu");
});

test("extractEmailDomain uses the LAST @ so a quoted local part can't spoof", () => {
  assert.equal(extractEmailDomain('"a@evil.com"@acme.edu'), "acme.edu");
});

test("extractEmailDomain returns null for input without a usable domain", () => {
  for (const input of ["", "jane", "jane@", "@acme.edu", "jane@localhost"]) {
    assert.equal(extractEmailDomain(input), null, JSON.stringify(input));
  }
});

// ── normalizeDomainInput ─────────────────────────────────

test("normalizeDomainInput accepts a bare domain", () => {
  assert.equal(normalizeDomainInput("Acme.COM"), "acme.com");
  assert.equal(normalizeDomainInput("  acme.co.uk  "), "acme.co.uk");
});

test("normalizeDomainInput accepts an email address", () => {
  // The connect field takes whatever identifies the organisation; the registry
  // is keyed by domain either way.
  assert.equal(normalizeDomainInput("Jane@Acme.EDU"), "acme.edu");
  assert.equal(normalizeDomainInput("jane+phone@acme.edu"), "acme.edu");
});

test("normalizeDomainInput accepts a pasted URL", () => {
  assert.equal(normalizeDomainInput("https://acme.com"), "acme.com");
  assert.equal(normalizeDomainInput("http://acme.com/login"), "acme.com");
  assert.equal(normalizeDomainInput("acme.com/"), "acme.com");
});

test("normalizeDomainInput uses the LAST @ so a quoted local part can't spoof", () => {
  assert.equal(normalizeDomainInput('"a@evil.com"@acme.edu'), "acme.edu");
});

test("normalizeDomainInput returns null for input with no usable domain", () => {
  // A value with no dot can never be a registered customer domain, so it is
  // rejected here rather than costing a round trip to find out.
  for (const input of ["", "   ", "acme", "jane@", "@acme.edu", "localhost"]) {
    assert.equal(normalizeDomainInput(input), null, JSON.stringify(input));
  }
});

// ── normalizeBaseUrl ─────────────────────────────────────

test("normalizeBaseUrl strips trailing slashes", () => {
  assert.equal(
    normalizeBaseUrl("https://acme.i.shelf.nu///"),
    "https://acme.i.shelf.nu"
  );
});

test("normalizeBaseUrl leaves a clean URL untouched", () => {
  assert.equal(
    normalizeBaseUrl("https://acme.i.shelf.nu"),
    "https://acme.i.shelf.nu"
  );
});

// ── parseServerConfigResponse ────────────────────────────

const validBody = {
  name: "Acme University",
  supabaseUrl: "https://xyz.supabase.co",
  supabaseAnonKey: "anon-key-123",
  mobileApiVersion: 1,
  ssoEnabled: true,
  passwordLoginEnabled: true,
};

test("parseServerConfigResponse accepts a well-formed body", () => {
  const result = parseServerConfigResponse(
    validBody,
    "https://acme.i.shelf.nu",
    false
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.config, {
    baseUrl: "https://acme.i.shelf.nu",
    supabaseUrl: "https://xyz.supabase.co",
    supabaseAnonKey: "anon-key-123",
    name: "Acme University",
    isCloud: false,
    ssoEnabled: true,
    passwordLoginEnabled: true,
  });
});

test("parseServerConfigResponse rejects a plaintext supabase URL", () => {
  const result = parseServerConfigResponse(
    { ...validBody, supabaseUrl: "http://xyz.supabase.co" },
    "https://acme.i.shelf.nu",
    false
  );
  assert.deepEqual(result, { ok: false, reason: "insecure" });
});

test("parseServerConfigResponse rejects a plaintext base URL", () => {
  const result = parseServerConfigResponse(
    validBody,
    "http://acme.i.shelf.nu",
    false
  );
  assert.deepEqual(result, { ok: false, reason: "insecure" });
});

test("parseServerConfigResponse rejects a server below the version floor", () => {
  const result = parseServerConfigResponse(
    { ...validBody, mobileApiVersion: 0 },
    "https://acme.i.shelf.nu",
    false
  );
  assert.deepEqual(result, { ok: false, reason: "unsupported_version" });
});

test("parseServerConfigResponse rejects a server above the version ceiling", () => {
  // why: the floor alone cannot protect an install that already exists. A
  // self-hoster upgrading to a future breaking version 2 leaves old phones in
  // the field; without a ceiling they read "2 >= 1" and proceed into a
  // contract they do not implement.
  const result = parseServerConfigResponse(
    { ...validBody, mobileApiVersion: MAX_SERVER_MOBILE_API_VERSION + 1 },
    "https://acme.i.shelf.nu",
    false
  );
  assert.deepEqual(result, { ok: false, reason: "unsupported_version" });
});

test("parseServerConfigResponse accepts a server at the version ceiling", () => {
  const result = parseServerConfigResponse(
    { ...validBody, mobileApiVersion: MAX_SERVER_MOBILE_API_VERSION },
    "https://acme.i.shelf.nu",
    false
  );
  assert.equal(result.ok, true);
});

test("parseServerConfigResponse rejects missing and empty fields", () => {
  for (const patch of [
    { supabaseUrl: undefined },
    { supabaseUrl: "" },
    { supabaseAnonKey: undefined },
    { supabaseAnonKey: "" },
    { mobileApiVersion: undefined },
    { mobileApiVersion: "1" },
  ]) {
    const result = parseServerConfigResponse(
      { ...validBody, ...patch },
      "https://acme.i.shelf.nu",
      false
    );
    assert.deepEqual(
      result,
      { ok: false, reason: "malformed" },
      JSON.stringify(patch)
    );
  }
});

test("parseServerConfigResponse rejects a host-less supabase URL", () => {
  // "https://" passes a bare prefix check, and normalizeBaseUrl then strips it
  // to "https:" — an unusable endpoint persisted as the Supabase URL, failing
  // opaquely at sign-in instead of here with an actionable reason.
  for (const supabaseUrl of ["https://", "https:///"]) {
    const result = parseServerConfigResponse(
      { ...validBody, supabaseUrl },
      "https://acme.i.shelf.nu",
      false
    );
    assert.deepEqual(result, { ok: false, reason: "malformed" }, supabaseUrl);
  }
});

test("parseServerConfigResponse rejects a host-less base URL", () => {
  for (const baseUrl of ["https://", "https:///"]) {
    const result = parseServerConfigResponse(validBody, baseUrl, false);
    assert.deepEqual(result, { ok: false, reason: "malformed" }, baseUrl);
  }
});

test("parseServerConfigResponse rejects an authority-less https URL", () => {
  // `new URL("https:xyz.supabase.co")` parses fine for special schemes —
  // scheme present, slashes omitted — so the prefix check has to stay
  // alongside the parse.
  const result = parseServerConfigResponse(
    { ...validBody, supabaseUrl: "https:xyz.supabase.co" },
    "https://acme.i.shelf.nu",
    false
  );
  assert.deepEqual(result, { ok: false, reason: "insecure" });
});

test("parseServerConfigResponse falls back to a default name", () => {
  const result = parseServerConfigResponse(
    { ...validBody, name: "   " },
    "https://acme.i.shelf.nu",
    false
  );
  assert.equal(result.ok && result.config.name, "Shelf");
});

test("parseServerConfigResponse rejects non-object bodies", () => {
  for (const body of [null, undefined, "string", 42, []]) {
    const result = parseServerConfigResponse(
      body,
      "https://acme.i.shelf.nu",
      false
    );
    assert.deepEqual(result, { ok: false, reason: "malformed" });
  }
});

test("parseServerConfigResponse normalises a trailing slash on both URLs", () => {
  const result = parseServerConfigResponse(
    { ...validBody, supabaseUrl: "https://xyz.supabase.co/" },
    "https://acme.i.shelf.nu/",
    false
  );
  assert.equal(result.ok && result.config.baseUrl, "https://acme.i.shelf.nu");
  assert.equal(
    result.ok && result.config.supabaseUrl,
    "https://xyz.supabase.co"
  );
});

test("isSameOrigin compares origins, ignoring path and trailing slash", () => {
  assert.equal(
    isSameOrigin("https://acme.i.shelf.nu/qr/abc", "https://acme.i.shelf.nu"),
    true
  );
  assert.equal(
    isSameOrigin("https://app.shelf.nu/qr/abc", "https://acme.i.shelf.nu"),
    false
  );
  assert.equal(isSameOrigin("not a url", "https://acme.i.shelf.nu"), false);
});

test("isSameOrigin rejects a QR minted by another Shelf server", () => {
  assert.equal(
    isSameOrigin(
      "https://other.i.shelf.nu/qr/abc123",
      "https://acme.i.shelf.nu"
    ),
    false
  );
});

test("isSameOrigin treats a scheme change as a different origin", () => {
  assert.equal(
    isSameOrigin("http://acme.i.shelf.nu/qr/abc", "https://acme.i.shelf.nu"),
    false
  );
});

// ── teardown key coverage ────────────────────────────────

test("SERVER_SCOPED_STORAGE_KEYS lists every key a switch must wipe", () => {
  // Guards against a new server-scoped key being added without teardown
  // coverage. Update this list AND the assertion together, never one alone.
  // `shelf_domain_resolutions` is written by no current code — it is swept so
  // installs that ran an earlier build do not keep a domain → private-server
  // map across a disconnect.
  assert.deepEqual(
    [...SERVER_SCOPED_STORAGE_KEYS],
    ["shelf_selected_org_id", "shelf_domain_resolutions"]
  );
});

test("SERVER_SCOPED_KEY_PREFIXES covers audit scan drafts", () => {
  assert.deepEqual([...SERVER_SCOPED_KEY_PREFIXES], ["shelf_audit_scan_"]);
});

test("device preference keys are not treated as server-scoped", () => {
  // These survive a switch by design. If one ever lands in either list, the
  // user loses their theme/start page every time they change servers.
  const devicePreferenceKeys = [
    "shelf_theme_preference",
    "shelf_start_page",
    "shelf_scan_sound_enabled",
    "shelf_review_success_count",
    "shelf_review_last_prompt",
  ];
  for (const key of devicePreferenceKeys) {
    assert.equal(SERVER_SCOPED_STORAGE_KEYS.includes(key), false, key);
    assert.equal(
      SERVER_SCOPED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
      false,
      key
    );
  }
});

// ── isAppVersionSupported ────────────────────────────────

test("isAppVersionSupported accepts any app version when no minimum is set", () => {
  for (const min of [null, undefined, ""]) {
    assert.equal(isAppVersionSupported("1.0.0", min as string | null), true);
  }
});

test("isAppVersionSupported compares numerically, not lexically", () => {
  // "1.10.0" < "1.9.0" as strings — the classic force-update bug that locks
  // every user out one minor release after the tenth.
  assert.equal(isAppVersionSupported("1.10.0", "1.9.0"), true);
  assert.equal(isAppVersionSupported("1.9.0", "1.10.0"), false);
  assert.equal(isAppVersionSupported("2.0.0", "10.0.0"), false);
});

test("isAppVersionSupported treats an equal version as supported", () => {
  assert.equal(isAppVersionSupported("1.3.0", "1.3.0"), true);
});

test("isAppVersionSupported handles differing segment counts", () => {
  assert.equal(isAppVersionSupported("1.3", "1.3.0"), true);
  assert.equal(isAppVersionSupported("1.3.1", "1.3"), true);
  assert.equal(isAppVersionSupported("1.2.9", "1.3"), false);
});

test("isAppVersionSupported fails OPEN on an unparseable version", () => {
  // A malformed value must never brick a working install: a typo'd env var on
  // the server would otherwise lock every user out of a fine app.
  assert.equal(isAppVersionSupported("1.3.0", "not-a-version"), true);
  assert.equal(isAppVersionSupported("", "1.3.0"), true);
  assert.equal(isAppVersionSupported("garbage", "1.3.0"), true);
});

test("isAppVersionSupported ignores a build suffix", () => {
  assert.equal(isAppVersionSupported("1.3.0-beta.2", "1.3.0"), true);
});

// ── isSessionServerMismatched ────────────────────────────

test("isSessionServerMismatched is false when the client matches the active server", () => {
  assert.equal(
    isSessionServerMismatched(
      "https://xyz.supabase.co",
      "https://xyz.supabase.co"
    ),
    false
  );
});

test("isSessionServerMismatched ignores trailing-slash differences", () => {
  // CLOUD_SERVER takes its URL straight from env while a switched/hydrated
  // config is normalized, so the two can differ by a trailing slash while
  // pointing at the same project. That is NOT a mismatch.
  assert.equal(
    isSessionServerMismatched(
      "https://xyz.supabase.co/",
      "https://xyz.supabase.co"
    ),
    false
  );
});

test("isSessionServerMismatched is true for a different project", () => {
  assert.equal(
    isSessionServerMismatched(
      "https://aaa.supabase.co",
      "https://bbb.supabase.co"
    ),
    true
  );
});

test("isSessionServerMismatched is false before a client exists", () => {
  // Nothing has been built yet, so there is no session to be wrong about.
  assert.equal(
    isSessionServerMismatched(null, "https://xyz.supabase.co"),
    false
  );
});

// ── classifyServerChange ─────────────────────────────────

const baseServer = {
  baseUrl: "https://acme.i.shelf.nu",
  supabaseUrl: "https://xyz.supabase.co",
  supabaseAnonKey: "anon-key-123",
  name: "Acme University",
  isCloud: false,
  ssoEnabled: true,
  passwordLoginEnabled: true,
};

test("classifyServerChange reports none for an identical config", () => {
  assert.equal(classifyServerChange(baseServer, { ...baseServer }), "none");
});

test("classifyServerChange reports credentials for a rotated anon key", () => {
  // The whole point: same instance, new key. A rotated anon key MUST classify
  // as `credentials` so the config refreshes in place — treating it as `none`
  // would strand the device on a dead key, and as a `switch` would sign the
  // user out and wipe their drafts for what is still the same server.
  assert.equal(
    classifyServerChange(baseServer, {
      ...baseServer,
      supabaseAnonKey: "anon-key-456",
    }),
    "credentials"
  );
});

test("classifyServerChange reports credentials for a moved Supabase project", () => {
  assert.equal(
    classifyServerChange(baseServer, {
      ...baseServer,
      supabaseUrl: "https://new.supabase.co",
    }),
    "credentials"
  );
});

test("classifyServerChange reports credentials for a renamed instance", () => {
  // Cheap to apply and the name is user-visible on the login chip and in
  // Settings, so a rename should not need a reinstall to show up.
  assert.equal(
    classifyServerChange(baseServer, { ...baseServer, name: "Acme Corp" }),
    "credentials"
  );
});

test("classifyServerChange reports switch for a different base URL", () => {
  assert.equal(
    classifyServerChange(baseServer, {
      ...baseServer,
      baseUrl: "https://other.i.shelf.nu",
    }),
    "switch"
  );
});

test("classifyServerChange reports switch when moving to or from cloud", () => {
  assert.equal(
    classifyServerChange(baseServer, {
      ...baseServer,
      baseUrl: "https://app.shelf.nu",
      isCloud: true,
    }),
    "switch"
  );
});

// ── decideServerCandidate ────────────────────────────────
//
// The connect flow's refusal table. `discovery.ts` is unreachable from this
// runner (it pulls Expo and AsyncStorage transitively), which is exactly why
// every verdict lives here instead.

test("decideServerCandidate refuses input that cannot be a domain", () => {
  for (const input of ["", "   ", "acme", "localhost"]) {
    const decision = decideServerCandidate(input, "https://acme.i.shelf.nu");
    assert.equal(decision.ok, false, JSON.stringify(input));
    assert.equal(!decision.ok && decision.reason, "invalid_domain");
  }
});

test("decideServerCandidate reports invalid input before the registry answer", () => {
  // Ordering matters: an unusable value must never be blamed on the lookup,
  // which the caller skips entirely in that case.
  const decision = decideServerCandidate("acme", undefined);
  assert.equal(!decision.ok && decision.reason, "invalid_domain");
});

test("decideServerCandidate distinguishes an unreachable registry from an unknown domain", () => {
  const unreachable = decideServerCandidate("acme.com", undefined);
  assert.equal(!unreachable.ok && unreachable.reason, "registry_unreachable");

  const unknown = decideServerCandidate("acme.com", null);
  assert.equal(!unknown.ok && unknown.reason, "not_registered");
});

test("decideServerCandidate names the domain in the not-registered message", () => {
  const decision = decideServerCandidate("Jane@Acme.COM", null);
  assert.equal(!decision.ok && decision.message.includes("acme.com"), true);
});

test("decideServerCandidate refuses a plaintext base URL from the registry", () => {
  // Defence in depth: the server already rejects these, so this makes the
  // invariant hold at both ends rather than only one.
  const decision = decideServerCandidate("acme.com", "http://acme.i.shelf.nu");
  assert.equal(!decision.ok && decision.reason, "incompatible");
});

test("decideServerCandidate passes a registered https base URL through", () => {
  const decision = decideServerCandidate("acme.com", "https://acme.i.shelf.nu");
  assert.deepEqual(decision, { ok: true, baseUrl: "https://acme.i.shelf.nu" });
});

// ── decideServerConnection ───────────────────────────────

/**
 * The parsed `validBody` as a real `ServerConfig`.
 *
 * Narrowed through the parser rather than hand-built, so these tests cannot
 * drift from the shape the parser actually produces.
 */
function validConfig() {
  const parsed = parseServerConfigResponse(
    validBody,
    "https://acme.i.shelf.nu",
    false
  );
  if (!parsed.ok) throw new Error("validBody should parse");
  return parsed.config;
}

test("decideServerConnection reports an unreachable server", () => {
  const outcome = decideServerConnection(null, "1.4.0");
  assert.equal(!outcome.ok && outcome.reason, "server_unreachable");
});

test("decideServerConnection refuses a server that answered with something invalid", () => {
  const outcome = decideServerConnection(
    { ok: false, reason: "malformed" },
    "1.4.0"
  );
  assert.equal(!outcome.ok && outcome.reason, "incompatible");
});

test("decideServerConnection tells a too-old SERVER apart from a too-old APP", () => {
  const serverTooOld = decideServerConnection(
    { ok: false, reason: "unsupported_version" },
    "1.4.0"
  );
  assert.equal(!serverTooOld.ok && serverTooOld.reason, "incompatible");
  assert.equal(
    !serverTooOld.ok &&
      serverTooOld.message.includes("server needs to be updated"),
    true
  );

  const appTooOld = decideServerConnection(
    { ok: true, config: validConfig(), minCompanionVersion: "2.0.0" },
    "1.4.0"
  );
  assert.equal(!appTooOld.ok && appTooOld.reason, "update_required");
});

test("decideServerConnection does NOT connect when the app is too old", () => {
  // The caller switches only on `ok: true`, so a refusal here is what keeps a
  // too-old build on the server it can still talk to.
  const outcome = decideServerConnection(
    { ok: true, config: validConfig(), minCompanionVersion: "9.9.9" },
    "1.4.0"
  );
  assert.equal(outcome.ok, false);
});

test("decideServerConnection returns the server when every gate passes", () => {
  const outcome = decideServerConnection(
    { ok: true, config: validConfig(), minCompanionVersion: null },
    "1.4.0"
  );
  assert.equal(outcome.ok, true);
  assert.equal(outcome.ok && outcome.server.name, "Acme University");
});

// ── advertised sign-in methods ───────────────────────────

test("parseServerConfigResponse disables a method only on an explicit false", () => {
  // A server predating these fields supports both; hiding a control on a
  // missing field would lock those users out of an app that works.
  const {
    ssoEnabled: _s,
    passwordLoginEnabled: _p,
    ...withoutFlags
  } = validBody;
  const older = parseServerConfigResponse(
    withoutFlags,
    "https://acme.i.shelf.nu",
    false
  );
  assert.equal(older.ok && older.config.ssoEnabled, true);
  assert.equal(older.ok && older.config.passwordLoginEnabled, true);

  const ssoOnly = parseServerConfigResponse(
    { ...validBody, passwordLoginEnabled: false },
    "https://acme.i.shelf.nu",
    false
  );
  assert.equal(ssoOnly.ok && ssoOnly.config.ssoEnabled, true);
  assert.equal(ssoOnly.ok && ssoOnly.config.passwordLoginEnabled, false);
});

test("classifyServerChange treats a capability change as a credentials refresh", () => {
  // Same server, different offer — the login screen must follow it without
  // signing the user out or wiping their drafts.
  assert.equal(
    classifyServerChange(baseServer, { ...baseServer, ssoEnabled: false }),
    "credentials"
  );
});
