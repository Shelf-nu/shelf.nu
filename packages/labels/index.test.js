/**
 * Drift guards for the shared label and tone maps.
 *
 * The package exists so the webapp and the companion app cannot say — or now
 * colour — the same status differently. Nothing in either app fails to compile
 * when a status is missing from a map here: the companion resolves its badge
 * maps through a `Record<string, …>` cast, so a gap surfaces as an
 * `undefined` colour pair on a phone, not as a build error. These tests are
 * what turns that into a failure at commit time.
 *
 * The enum lists on the right-hand side are copied by hand from
 * `packages/database/prisma/schema.prisma`, following the same convention as
 * `@shelf/quantity-control`'s enum-parity guard — the package takes no
 * dependency on Prisma so that Metro can bundle it.
 *
 * @see {@link file://../database/prisma/schema.prisma}
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUDIT_ASSET_STATUS_LABELS,
  AUDIT_ASSET_STATUS_TONES,
  AUDIT_STATUS_LABELS,
  AUDIT_STATUS_TONES,
  auditAssetStatusLabel,
  isAuditCompleted,
} from "./index.js";

/** The tones both apps know how to resolve. Adding one means touching both. */
const STATUS_TONES = ["neutral", "info", "success", "warning", "danger"];

/** Compares two key lists as sets, so declaration order is free to change. */
function assertSameKeys(actual, expected) {
  assert.deepEqual(Object.keys(actual).sort(), [...expected].sort());
}

// ---------------------------------------------------------------------------
// Label maps vs the database enums
// ---------------------------------------------------------------------------

test("AUDIT_STATUS_LABELS covers the AuditStatus enum", () => {
  // enum AuditStatus { PENDING, ACTIVE, COMPLETED, CANCELLED, ARCHIVED }
  assertSameKeys(AUDIT_STATUS_LABELS, [
    "PENDING",
    "ACTIVE",
    "COMPLETED",
    "CANCELLED",
    "ARCHIVED",
  ]);
});

test("AUDIT_ASSET_STATUS_LABELS covers the AuditAssetStatus enum", () => {
  // enum AuditAssetStatus { PENDING, FOUND, MISSING, UNEXPECTED }
  assertSameKeys(AUDIT_ASSET_STATUS_LABELS, [
    "PENDING",
    "FOUND",
    "MISSING",
    "UNEXPECTED",
  ]);
});

// ---------------------------------------------------------------------------
// Tone maps
// ---------------------------------------------------------------------------

test("every audit status has a tone", () => {
  assertSameKeys(AUDIT_STATUS_TONES, Object.keys(AUDIT_STATUS_LABELS));
});

test("every per-asset audit status has a tone", () => {
  assertSameKeys(
    AUDIT_ASSET_STATUS_TONES,
    Object.keys(AUDIT_ASSET_STATUS_LABELS)
  );
});

test("every tone is one both apps can resolve", () => {
  for (const [status, tone] of [
    ...Object.entries(AUDIT_STATUS_TONES),
    ...Object.entries(AUDIT_ASSET_STATUS_TONES),
  ]) {
    assert.ok(
      STATUS_TONES.includes(tone),
      `${status} has tone "${tone}", which no app maps to a colour`
    );
  }
});

test("a missing asset outranks an unexpected one", () => {
  // The two apps painted these the opposite way round for a release. The
  // ranking is the whole reason the tones are shared, so it gets pinned:
  // absent equipment needs action, a surprise find is only filed wrong.
  assert.equal(AUDIT_ASSET_STATUS_TONES.MISSING, "danger");
  assert.equal(AUDIT_ASSET_STATUS_TONES.UNEXPECTED, "warning");
});

test("a not-yet-started audit is not an alarm", () => {
  // Urgency belongs to the due date beside the badge, not to PENDING itself.
  assert.equal(AUDIT_STATUS_TONES.PENDING, "neutral");
});

// ---------------------------------------------------------------------------
// Completion rule
// ---------------------------------------------------------------------------

test("an unscanned asset is only missing once the audit is closed", () => {
  assert.equal(auditAssetStatusLabel("PENDING", false), "Not scanned");
  assert.equal(auditAssetStatusLabel("PENDING", true), "Missing");
});

test("every other status reads the same either side of completion", () => {
  for (const status of ["FOUND", "MISSING", "UNEXPECTED"]) {
    assert.equal(
      auditAssetStatusLabel(status, false),
      AUDIT_ASSET_STATUS_LABELS[status]
    );
    assert.equal(
      auditAssetStatusLabel(status, true),
      AUDIT_ASSET_STATUS_LABELS[status]
    );
  }
});

test("completion is read from completedAt, in either apps' shape", () => {
  // The webapp passes a Date, the companion an ISO string over JSON.
  assert.equal(isAuditCompleted({ completedAt: new Date() }), true);
  assert.equal(isAuditCompleted({ completedAt: "2026-08-20T10:00:00Z" }), true);
  assert.equal(isAuditCompleted({ completedAt: null }), false);
  assert.equal(isAuditCompleted({}), false);
  assert.equal(isAuditCompleted(null), false);
  assert.equal(isAuditCompleted(undefined), false);
});

test("an archived audit that was completed stays completed", () => {
  // Archiving rewrites `status` but keeps the timestamp, which is why the
  // helper never looks at `status`.
  assert.equal(
    isAuditCompleted({ status: "ARCHIVED", completedAt: new Date() }),
    true
  );
  assert.equal(
    isAuditCompleted({ status: "ARCHIVED", completedAt: null }),
    false
  );
});

// ---------------------------------------------------------------------------
// The maps are shared state
// ---------------------------------------------------------------------------

test("the exported maps cannot be mutated by a consumer", () => {
  for (const map of [
    AUDIT_STATUS_LABELS,
    AUDIT_ASSET_STATUS_LABELS,
    AUDIT_STATUS_TONES,
    AUDIT_ASSET_STATUS_TONES,
  ]) {
    assert.ok(Object.isFrozen(map));
  }
});
