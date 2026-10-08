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
  ASSET_BOOKING_PSEUDO_STATUS_LABELS,
  ASSET_STATUS_LABELS,
  AUDIT_ASSET_STATUS_LABELS,
  AUDIT_ASSET_STATUS_TONES,
  AUDIT_DELETED_ASSET_LABELS,
  AUDIT_STATUS_LABELS,
  AUDIT_STATUS_TONES,
  BOOKING_METHOD,
  ASSET_TYPE_ADJECTIVES,
  ASSET_TYPE_LABELS,
  CONSUMPTION_TYPE_ADJECTIVES,
  CONSUMPTION_TYPE_DESCRIPTIONS,
  CONSUMPTION_TYPE_LABELS,
  CLIENT_DECLARED_BOOKING_METHODS,
  EXPLICIT_REQUIREMENT_LABELS,
  EXPLICIT_REQUIREMENT_ROLE_LABELS,
  explicitRequirementSwitchDescription,
  KIT_MEMBERS_CUSTODY_BLOCKED_REASON,
  KIT_STATUS_LABELS,
  auditAssetStatusLabel,
  auditDeletedAssetLabel,
  isAuditCompleted,
  kitMemberCustodyBlockedReason,
  kitMemberCustodyRefusal,
  kitMembersCustodyRefusal,
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

test("KIT_STATUS_LABELS covers the KitStatus enum", () => {
  // enum KitStatus { AVAILABLE, IN_CUSTODY, CHECKED_OUT }
  // PARTIALLY_CHECKED_IN is not persisted: a booking derives it when every
  // member it holds has been checked back in.
  assertSameKeys(KIT_STATUS_LABELS, [
    "AVAILABLE",
    "IN_CUSTODY",
    "CHECKED_OUT",
    "PARTIALLY_CHECKED_IN",
  ]);
});

test("a kit and an asset say the same thing about being back", () => {
  assert.equal(
    KIT_STATUS_LABELS.PARTIALLY_CHECKED_IN,
    ASSET_BOOKING_PSEUDO_STATUS_LABELS.ALREADY_CHECKED_IN
  );
});

test("a kit and an asset are named alike", () => {
  // A booking lists a kit and the assets inside it on one screen, so the three
  // states both enums share have to read identically. The two maps stay
  // separate — their key sets follow different database enums — which is why
  // the agreement is pinned here rather than expressed as a spread.
  for (const status of ["AVAILABLE", "IN_CUSTODY", "CHECKED_OUT"]) {
    assert.equal(KIT_STATUS_LABELS[status], ASSET_STATUS_LABELS[status]);
  }
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
    ASSET_STATUS_LABELS,
    KIT_STATUS_LABELS,
    AUDIT_STATUS_LABELS,
    AUDIT_ASSET_STATUS_LABELS,
    AUDIT_DELETED_ASSET_LABELS,
    AUDIT_STATUS_TONES,
    AUDIT_ASSET_STATUS_TONES,
  ]) {
    assert.ok(Object.isFrozen(map));
  }
});

// ---------------------------------------------------------------------------
// Deleted-asset wording
// ---------------------------------------------------------------------------

test("a deleted asset keeps the title it was scanned under", () => {
  assert.equal(
    auditDeletedAssetLabel("Arri Fresnel 650"),
    "Arri Fresnel 650 (deleted)"
  );
});

test("a deleted asset with no snapshotted title says only what it is", () => {
  // A scan recorded before the title was captured by value has nothing left to
  // qualify, so the row must not read " (deleted)" with an empty name.
  for (const empty of [null, undefined, "", "   "]) {
    assert.equal(auditDeletedAssetLabel(empty), "Deleted asset");
  }
});

test("surrounding whitespace never reaches the rendered name", () => {
  assert.equal(auditDeletedAssetLabel("  Tripod  "), "Tripod (deleted)");
});

test("ASSET_TYPE maps cover the AssetType enum", () => {
  // enum AssetType { INDIVIDUAL, QUANTITY_TRACKED }
  assertSameKeys(ASSET_TYPE_LABELS, ["INDIVIDUAL", "QUANTITY_TRACKED"]);
  // The adjective is used wherever the label would sit in front of a noun, so
  // a missing one renders "undefined assets".
  assertSameKeys(ASSET_TYPE_ADJECTIVES, Object.keys(ASSET_TYPE_LABELS));
});

test("CONSUMPTION_TYPE maps cover the ConsumptionType enum", () => {
  // enum ConsumptionType { ONE_WAY, TWO_WAY }
  assertSameKeys(CONSUMPTION_TYPE_LABELS, ["ONE_WAY", "TWO_WAY"]);
  // A label without its description would render "Used up (one-way) —
  // undefined" wherever the two are joined.
  assertSameKeys(
    CONSUMPTION_TYPE_DESCRIPTIONS,
    Object.keys(CONSUMPTION_TYPE_LABELS)
  );
});

// ---------------------------------------------------------------------------
// Explicit check-in / check-out requirement
// ---------------------------------------------------------------------------

test("the two explicit-requirement cards say the same thing, verb aside", () => {
  const { CHECKIN, CHECKOUT } = EXPLICIT_REQUIREMENT_LABELS;
  // A reader who learned one card must be able to read the other without
  // re-reading it, so the sentences differ only in "check in" vs "check out".
  const sameShape = (a, b) =>
    a.replace(/check-in|check in/gi, "check-X") ===
    b.replace(/check-out|check out/gi, "check-X");
  assert.ok(sameShape(CHECKIN.TITLE, CHECKOUT.TITLE));
  assert.ok(sameShape(CHECKIN.EXEMPTION, CHECKOUT.EXEMPTION));
  assert.ok(sameShape(CHECKIN.PHONE_HINT, CHECKOUT.PHONE_HINT));
});

test("the exemption names both roles the switches never apply to", () => {
  for (const direction of ["CHECKIN", "CHECKOUT"]) {
    const sentence = EXPLICIT_REQUIREMENT_LABELS[direction].EXEMPTION;
    assert.match(sentence, /workspace owner is never restricted/);
    assert.match(sentence, /Base users cannot check (in|out)/);
  }
});

test("a switch description names its role and both explicit ways", () => {
  const admin = explicitRequirementSwitchDescription("CHECKIN", "ADMIN");
  assert.equal(
    admin,
    "Removes the one-click check-in for Admins. They check items in by scanning them or by selecting them from the list."
  );
  const selfService = explicitRequirementSwitchDescription(
    "CHECKOUT",
    "SELF_SERVICE"
  );
  assert.equal(
    selfService,
    "Removes the one-click check-out for Self Service users. They check items out by scanning them or by selecting them from the list."
  );
});

test("the switch roles are exactly the two the rule can cover", () => {
  // OWNER is exempt and BASE holds no check-in or check-out permission, so a
  // switch for either would be a switch that changes nothing.
  assertSameKeys(EXPLICIT_REQUIREMENT_ROLE_LABELS, ["ADMIN", "SELF_SERVICE"]);
});

test("the kit-member custody reasons name the kit and give both ways out", () => {
  // The single-asset reason, the server refusal and the bulk reason are read
  // side by side (a disabled menu item, then the 400 from a direct request), so
  // all three must offer the same two ways out.
  const waysOut =
    /Assign custody to the kit, or remove (the asset|them) from the kit first\.$/;

  assert.equal(
    kitMemberCustodyBlockedReason("Camera Kit"),
    'This asset is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.'
  );
  assert.equal(
    kitMemberCustodyRefusal({ assetTitle: "Tripod", kitName: "Camera Kit" }),
    '"Tripod" is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.'
  );
  assert.match(kitMemberCustodyBlockedReason("Camera Kit"), waysOut);
  assert.match(
    kitMemberCustodyRefusal({ assetTitle: "Tripod", kitName: "Camera Kit" }),
    waysOut
  );
  assert.match(KIT_MEMBERS_CUSTODY_BLOCKED_REASON, waysOut);
});

test("the multi-member refusal counts the members and names the first three", () => {
  const member = (assetTitle) => ({ assetTitle, kitName: "Camera Kit" });

  assert.equal(
    kitMembersCustodyRefusal([member("Tripod")]),
    kitMemberCustodyRefusal(member("Tripod"))
  );
  assert.equal(
    kitMembersCustodyRefusal([member("Tripod"), member("Gimbal")]),
    '2 of the selected assets are part of a kit: "Tripod" and "Gimbal". Assign custody to the kit, or remove them from the kit first.'
  );
  assert.equal(
    kitMembersCustodyRefusal(
      ["Tripod", "Gimbal", "Mic", "Light", "Stand"].map(member)
    ),
    '5 of the selected assets are part of a kit: "Tripod", "Gimbal", "Mic" and 2 more. Assign custody to the kit, or remove them from the kit first.'
  );
});

test("the declarable booking methods are BOOKING_METHOD's values, never quick", () => {
  // The server validates the request field against the tuple and the app sends
  // BOOKING_METHOD values, so the two must list the same words.
  assert.deepEqual(
    [...CLIENT_DECLARED_BOOKING_METHODS].sort(),
    Object.values(BOOKING_METHOD).sort()
  );
  assert.equal(CLIENT_DECLARED_BOOKING_METHODS.includes("quick"), false);
});
