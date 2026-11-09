/**
 * Tests for the booking "Discard draft" rules.
 *
 * The flag fixtures use the exact `bookingActions` shape the webapp's mobile
 * booking detail route emits (pinned on that side by
 * `test/routes-tests/api+/mobile+/bookings.$bookingId.discard-draft-flag.test.ts`).
 *
 * @see {@link file://./booking-discard-draft.ts}
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { BookingDetailResponse } from "./api/types";
import { canOfferDiscardDraft, discardOutcome } from "./booking-discard-draft";

test("canOfferDiscardDraft offers the action only when the server sends true", () => {
  // The full flag set a server sends, minus the flag under test.
  const actions: BookingDetailResponse["bookingActions"] = {
    canEdit: true,
    canCancel: false,
    canArchive: false,
    canDuplicate: true,
    canDelete: false,
    canExtend: false,
  };

  assert.equal(
    canOfferDiscardDraft({ ...actions, canDiscardDraft: true }),
    true
  );
  assert.equal(
    canOfferDiscardDraft({ ...actions, canDiscardDraft: false }),
    false
  );
  // A server that predates the flag cannot discard a draft.
  assert.equal(canOfferDiscardDraft(actions), false);
});

test("discardOutcome reads a failed discard from the re-read booking", () => {
  assert.equal(discardOutcome({ status: "ARCHIVED" }), "landed");
  assert.equal(discardOutcome({ status: "DRAFT" }), "not-landed");
  // The re-read failed too: the discard may or may not have gone through.
  assert.equal(discardOutcome(null), "unknown");
});
