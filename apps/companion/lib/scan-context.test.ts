/**
 * Tests for the scan context header.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * The contract under test: only the audit scanner marks its barcode resolves
 * as audit scans (recorded as `AUDIT`, no Activity note). The normal scanner
 * sends no context, so the server keeps recording `COMPANION` with a note.
 *
 * @see ./scan-context.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { scanContextHeaders } from "./scan-context";

test("audit scanner sends X-Scan-Context: audit", () => {
  assert.deepEqual(scanContextHeaders("audit"), {
    "X-Scan-Context": "audit",
  });
});

test("normal scanner sends no scan context", () => {
  assert.deepEqual(scanContextHeaders(), {});
  assert.deepEqual(scanContextHeaders(undefined), {});
});
