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
  AUDIT_PHOTO_FLAG_LABELS,
  AUDIT_PHOTO_KEY,
  AUDIT_PHOTO_SOURCE_LABELS,
  describeAuditPhoto,
  ASSET_BOOKING_PSEUDO_STATUS_LABELS,
  ASSET_STATUS_LABELS,
  AUDIT_ASSET_STATUS_LABELS,
  AUDIT_ASSET_STATUS_TONES,
  AUDIT_DELETED_ASSET_LABELS,
  AUDIT_STATUS_LABELS,
  AUDIT_STATUS_TONES,
  BOOKING_METHOD,
  DELETE_CONFIRMATION_FIELD,
  DELETE_CONSEQUENCE_LABELS,
  deleteConfirmationMatches,
  deleteConfirmationTarget,
  normalizeDeleteConfirmation,
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
  KIT_IN_USE_REINSTATE_REASON,
  KIT_STATUS_LABELS,
  auditAssetStatusLabel,
  auditDeletedAssetLabel,
  isAuditCompleted,
  kitMemberCustodyBlockedReason,
  kitMemberCustodyRefusal,
  kitMembersCustodyRefusal,
  archivedAssetBlockedReason,
  archivedAssetsLeftOut,
  archivedAssetsRefusal,
  kitWithoutActiveAssetsReason,
  kitsWithoutActiveAssetsRefusal,
  WITHHELD_CUSTODIAN_NAME,
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
    "Removes the one-click check-in for Admins and Managers. They check items in by scanning them or by selecting them from the list."
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

test("an archived asset's disabled reason never offers a reinstate the reader lacks", () => {
  assert.equal(
    archivedAssetBlockedReason({ canReinstate: true }),
    "This asset is archived. Reinstate it to make changes."
  );
  assert.equal(
    archivedAssetBlockedReason({ canReinstate: true, action: "book" }),
    "This asset is archived. Reinstate it to book it."
  );
  for (const action of ["change", "book"]) {
    const reason = archivedAssetBlockedReason({ canReinstate: false, action });
    assert.equal(
      reason,
      "This asset is archived. Ask an admin to reinstate it."
    );
    assert.doesNotMatch(reason, /Reinstate it/);
  }
  // A reinstate held up by an in-use kit names the way out.
  assert.match(
    KIT_IN_USE_REINSTATE_REASON,
    /Release or check in the kit first/
  );
});

test("the archived refusal names the assets and the way out for this reader", () => {
  assert.equal(
    archivedAssetsRefusal({
      titles: ["Cam A"],
      fix: "reinstate",
      canReinstate: true,
    }),
    '"Cam A" is archived. Reinstate it to make changes.'
  );
  assert.equal(
    archivedAssetsRefusal({
      titles: ["Cam A"],
      fix: "reinstate",
      canReinstate: false,
    }),
    '"Cam A" is archived. Ask an admin to reinstate it.'
  );
  assert.equal(
    archivedAssetsRefusal({
      titles: ["Cam A", "Cam B"],
      fix: "remove-from-list",
      canReinstate: false,
    }),
    '"Cam A" and "Cam B" are archived. Remove them from the list and try again.'
  );
  assert.equal(
    archivedAssetsRefusal({
      titles: ["A", "B", "C", "D", "E"],
      fix: "remove-from-booking",
      canReinstate: true,
    }),
    '"A", "B", "C" and 2 more are archived. Remove them from the booking or reinstate them.'
  );
  assert.equal(
    archivedAssetsRefusal({
      titles: ["Cam A"],
      fix: "remove-from-booking",
      canReinstate: false,
    }),
    '"Cam A" is archived. Remove it from the booking or ask an admin to reinstate it.'
  );
});

test("left-out counts agree in number", () => {
  assert.equal(archivedAssetsLeftOut(1), "1 archived asset was left out.");
  assert.equal(archivedAssetsLeftOut(3), "3 archived assets were left out.");
});

test("a kit with no active asset says whether it is empty or only archived", () => {
  assert.equal(
    kitsWithoutActiveAssetsRefusal({
      kits: [{ name: "Camera Kit", hasArchivedAssets: true }],
      action: "custody",
    }),
    'Kit "Camera Kit" holds only archived assets, so there is nothing to put into custody. Add an active asset to it, or have an admin reinstate one.'
  );
  assert.equal(
    kitsWithoutActiveAssetsRefusal({
      kits: [{ name: "Camera Kit", hasArchivedAssets: false }],
      action: "booking",
    }),
    'Kit "Camera Kit" has no assets, so there is nothing to book. Add assets to it first.'
  );
  assert.equal(
    kitsWithoutActiveAssetsRefusal({
      kits: ["A", "B", "C", "D"].map((name) => ({
        name,
        hasArchivedAssets: true,
      })),
      action: "custody",
    }),
    '4 kits have no active assets, so there is nothing to put into custody: "A", "B", "C" and 1 more. Add active assets to them first.'
  );
  assert.equal(
    kitWithoutActiveAssetsReason({
      hasArchivedAssets: true,
      action: "booking",
    }),
    "This kit holds only archived assets. Add an active asset to book this kit."
  );
  assert.equal(
    kitWithoutActiveAssetsReason({
      hasArchivedAssets: false,
      action: "custody",
    }),
    "This kit has no assets. Add assets to assign custody."
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

test("a typed delete confirmation matches its name loosely but never blank", () => {
  // Case, edge whitespace and doubled spaces do not decide a delete.
  assert.equal(
    deleteConfirmationMatches("  camera   kit ", "Camera Kit"),
    true
  );
  // A composed é (NFC) and a decomposed one (NFD, as macOS can type it).
  assert.equal(deleteConfirmationMatches("Résumé", "Résumé"), true);
  // Counts are compared as text.
  assert.equal(deleteConfirmationMatches("12", 12), true);
  assert.equal(deleteConfirmationMatches(" 12 ", 12), true);
  // A different name, a prefix or a different count is refused.
  assert.equal(deleteConfirmationMatches("Camera", "Camera Kit"), false);
  assert.equal(deleteConfirmationMatches("11", 12), false);
  // Nothing typed never unlocks, whatever the name.
  assert.equal(deleteConfirmationMatches("", "Camera Kit"), false);
  assert.equal(deleteConfirmationMatches(undefined, "Camera Kit"), false);
  assert.equal(deleteConfirmationMatches("", ""), false);
  assert.equal(deleteConfirmationMatches("   ", "  "), false);
});

test("a nameless item is confirmed by typing the word delete", () => {
  for (const name of ["", "   ", "\u200B"]) {
    assert.equal(deleteConfirmationMatches("Delete ", name), true);
    assert.equal(deleteConfirmationMatches("delete", name), true);
    assert.equal(deleteConfirmationMatches("", name), false);
    assert.equal(deleteConfirmationMatches("  ", name), false);
    assert.equal(deleteConfirmationMatches(undefined, name), false);
  }
  // An item with a name still asks for the name, not the word.
  assert.equal(deleteConfirmationMatches("delete", "Camera Kit"), false);
});

test("what to type is the name or count, or the word delete for a nameless item", () => {
  assert.equal(deleteConfirmationTarget("Camera Kit"), "Camera Kit");
  assert.equal(deleteConfirmationTarget(12), "12");
  for (const name of ["", "   ", "\u200B", "\uFEFF "]) {
    assert.equal(deleteConfirmationTarget(name), "delete");
  }
});

test("an invisible character between a letter and its accent still matches the composed letter", () => {
  // "Cafe" + zero-width space + combining acute, shown as "Café"
  assert.equal(
    deleteConfirmationMatches("Caf\u00E9", "Cafe\u200B\u0301"),
    true
  );
  assert.equal(deleteConfirmationMatches("Cafe\u0301", "Caf\u00E9"), true);
});

test("invisible format characters in a stored name need not be typed", () => {
  // Zero-width space, non-joiner and joiner, and a byte order mark: none can
  // be seen in the instruction, so none is asked for.
  assert.equal(deleteConfirmationMatches("CameraKit", "Camera\u200BKit"), true);
  assert.equal(deleteConfirmationMatches("Tripod", "Tripod\u200B"), true);
  assert.equal(deleteConfirmationMatches("CameraKit", "Camera\u200CKit"), true);
  assert.equal(deleteConfirmationMatches("CameraKit", "Camera\u200DKit"), true);
  assert.equal(deleteConfirmationMatches("CameraKit", "Camera\uFEFFKit"), true);
  assert.equal(
    deleteConfirmationMatches("Camera Kit", "Camera \u200BKit"),
    true
  );
  // A pasted name that carries the character matches as well.
  assert.equal(
    deleteConfirmationMatches("Camera\u200BKit", "Camera\u200BKit"),
    true
  );
  assert.equal(deleteConfirmationMatches("Camera", "Camera\u200BKit"), false);
  // Soft hyphen, word joiner and a left-to-right mark are invisible too.
  assert.equal(deleteConfirmationMatches("CameraKit", "Camera\u00ADKit"), true);
  assert.equal(deleteConfirmationMatches("CameraKit", "Camera\u2060Kit"), true);
  assert.equal(deleteConfirmationMatches("CameraKit", "\u200ECameraKit"), true);
});

test("the confirmation field name is the one the bulk endpoints read", () => {
  assert.equal(DELETE_CONFIRMATION_FIELD, "confirmation");
  assert.equal(normalizeDeleteConfirmation(null), "");
});

test("each delete consequence says it is permanent", () => {
  for (const text of Object.values(DELETE_CONSEQUENCE_LABELS)) {
    assert.match(text, /permanently deletes/);
    assert.match(text, /This cannot be undone\.$/);
    // House rule: no em or en dashes in user-facing strings.
    assert.doesNotMatch(text, /[\u2013\u2014]/);
  }
});

test("a withheld custodian is a name, never the empty answer", () => {
  // Clients render `null` as "no custodian" and this string as "hidden", so it
  // must stay a non-empty string a row can carry in the name slot.
  assert.equal(typeof WITHHELD_CUSTODIAN_NAME, "string");
  assert.ok(WITHHELD_CUSTODIAN_NAME.trim().length > 0);
});

/** Formatters that show which one was used: dates as d(...), times as t(...). */
const format = {
  date: (value) => `d(${new Date(value).toISOString().slice(0, 10)})`,
  time: (value) => `t(${new Date(value).toISOString().slice(11, 16)})`,
  dateTime: (value) => `dt(${new Date(value).toISOString().slice(0, 16)})`,
};
const AUDIT_STARTED = "2026-10-28T09:00:00Z";
const describe = (photo) =>
  describeAuditPhoto(photo, { auditStartedAt: AUDIT_STARTED, format });

test("a camera photo taken during the audit is quiet: icon, time, no flag", () => {
  const photo = describe({
    captureSource: "CAMERA",
    capturedAt: "2026-10-28T10:56:00Z",
    createdAt: "2026-10-28T10:58:00Z",
  });

  assert.equal(photo.source, "CAMERA");
  assert.equal(photo.short, "t(10:56)");
  assert.equal(photo.flag, null);
  assert.equal(
    photo.detail,
    "Shelf app camera · dt(2026-10-28T10:56) · 2 min before upload"
  );
});

test("a photo taken before the audit started is flagged, with how much older", () => {
  const photo = describe({
    captureSource: "LIBRARY",
    capturedAt: "2026-10-01T06:30:00Z",
    createdAt: "2026-10-28T10:52:00Z",
  });

  assert.equal(photo.short, "d(2026-10-01)");
  assert.equal(photo.flag, "OLDER_THAN_AUDIT");
  assert.equal(photo.flagLabel, "Older than audit");
  assert.equal(
    photo.detail,
    "Photo library · file says dt(2026-10-01T06:30) · 27 days before this audit started"
  );
});

test("a photo with no date is flagged, and a library one never borrows its upload time", () => {
  const photo = describe({
    captureSource: "LIBRARY",
    capturedAt: null,
    createdAt: "2026-10-28T10:52:00Z",
  });

  assert.equal(photo.short, null);
  assert.equal(photo.flag, "NO_DATE");
  assert.equal(photo.detail, "Photo library · time taken unknown");
});

test("a camera photo with no EXIF date shows its upload time, and says so", () => {
  const photo = describe({
    captureSource: "CAMERA",
    capturedAt: null,
    createdAt: "2026-10-28T10:58:00Z",
  });

  assert.equal(photo.short, "t(10:58)");
  assert.equal(photo.flag, null);
  assert.equal(
    photo.detail,
    "Shelf app camera · uploaded dt(2026-10-28T10:58)"
  );
});

test("a photo from before capture sources keeps a plain time line", () => {
  const photo = describe({
    capturedAt: "2026-10-28T10:00:00Z",
    createdAt: null,
  });

  assert.equal(photo.source, null);
  assert.equal(photo.sourceLabel, null);
  assert.equal(photo.short, "d(2026-10-28)");
  assert.equal(photo.detail, "Taken dt(2026-10-28T10:00)");
});

test("no flag for age when the audit has not started", () => {
  const photo = describeAuditPhoto(
    { captureSource: "LIBRARY", capturedAt: "2020-01-01T00:00:00Z" },
    { auditStartedAt: null, format }
  );

  assert.equal(photo.flag, null);
});

test("audit photo labels carry no dashes", () => {
  assert.deepEqual(Object.keys(AUDIT_PHOTO_SOURCE_LABELS), [
    "CAMERA",
    "LIBRARY",
    "WEB_UPLOAD",
  ]);
  for (const text of [
    ...Object.values(AUDIT_PHOTO_SOURCE_LABELS),
    ...Object.values(AUDIT_PHOTO_FLAG_LABELS),
    AUDIT_PHOTO_KEY,
  ]) {
    assert.doesNotMatch(text, /[\u2013\u2014]/);
  }
});
