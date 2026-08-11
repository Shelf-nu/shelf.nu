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
  extractEmailDomain,
  isResolutionFresh,
  isSameOrigin,
  normalizeBaseUrl,
  parseServerConfigResponse,
  RESOLUTION_CACHE_TTL_MS,
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

// ── isResolutionFresh ────────────────────────────────────

test("isResolutionFresh honours the TTL boundary", () => {
  const now = 1_000_000_000_000;
  assert.equal(isResolutionFresh({ baseUrl: null, cachedAt: now }, now), true);
  assert.equal(
    isResolutionFresh(
      { baseUrl: null, cachedAt: now - RESOLUTION_CACHE_TTL_MS + 1 },
      now
    ),
    true
  );
  assert.equal(
    isResolutionFresh(
      { baseUrl: null, cachedAt: now - RESOLUTION_CACHE_TTL_MS },
      now
    ),
    false
  );
});

test("isResolutionFresh treats a future timestamp as stale", () => {
  const now = 1_000_000_000_000;
  // Clock moved backwards — never let an entry from the "future" pin forever.
  assert.equal(
    isResolutionFresh({ baseUrl: null, cachedAt: now + 60_000 }, now),
    false
  );
});

// ── isSameOrigin ─────────────────────────────────────────

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

test("SERVER_SCOPED_STORAGE_KEYS lists the selected organisation", () => {
  // Guards against a new server-scoped key being added without teardown
  // coverage. Update this list AND the assertion together, never one alone.
  assert.deepEqual([...SERVER_SCOPED_STORAGE_KEYS], ["shelf_selected_org_id"]);
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
