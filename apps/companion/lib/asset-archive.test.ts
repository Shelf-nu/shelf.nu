/**
 * Tests for archiving an asset from the phone: who is offered it, why it is
 * blocked before the tap, the More menu order, and the "Archive anyway" flow.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./asset-archive.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ARCHIVE_UNAVAILABLE_MESSAGE,
  archiveBlockedReason,
  archiveFailureMessage,
  canOfferArchive,
  moreMenuActions,
  runArchive,
  settleArchiveChange,
  type ArchiveAnswer,
} from "./asset-archive";
import { assetChangeVersion } from "./asset-refresh";

// ── Who is offered Archive ───────────────────────────────

test("an admin or owner is offered Archive on an active asset", () => {
  assert.equal(
    canOfferArchive({ canUpdate: true, canArchive: true, isArchived: false }),
    true
  );
});

test("a member without the archive grant is not offered it", () => {
  // A Manager may edit assets but not archive them.
  assert.equal(
    canOfferArchive({ canUpdate: true, canArchive: false, isArchived: false }),
    false
  );
});

test("a member without the update grant is not offered it, as on the web", () => {
  assert.equal(
    canOfferArchive({ canUpdate: false, canArchive: true, isArchived: false }),
    false
  );
});

test("an archived asset offers Reinstate, not Archive", () => {
  assert.equal(
    canOfferArchive({ canUpdate: true, canArchive: true, isArchived: true }),
    false
  );
});

// ── Why it is blocked before the tap ─────────────────────

const available = {
  status: "AVAILABLE",
  custody: null,
  kit: null,
};

test("an available individual asset can be archived", () => {
  assert.equal(archiveBlockedReason(available, false), null);
});

test("a quantity-tracked asset is refused with the web's words", () => {
  assert.equal(
    archiveBlockedReason(available, true),
    "Quantity-tracked assets can't be archived yet."
  );
});

test("a checked-out asset is refused", () => {
  assert.equal(
    archiveBlockedReason({ ...available, status: "CHECKED_OUT" }, false),
    "Check the asset in and release any custody before archiving it."
  );
});

test("an asset in custody is refused", () => {
  assert.equal(
    archiveBlockedReason(
      { ...available, status: "IN_CUSTODY", custody: { id: "c1" } },
      false
    ),
    "Check the asset in and release any custody before archiving it."
  );
});

test("a member of a kit in use is refused; one of an available kit is not", () => {
  assert.equal(
    archiveBlockedReason(
      { ...available, kit: { status: "IN_CUSTODY" } },
      false
    ),
    "This asset is part of a kit that's currently in use."
  );
  assert.equal(
    archiveBlockedReason({ ...available, kit: { status: "AVAILABLE" } }, false),
    null
  );
});

// ── The More menu ────────────────────────────────────────

test("Archive comes first and Delete last", () => {
  assert.deepEqual(moreMenuActions({ offerArchive: true, canDelete: true }), [
    "archive",
    "delete",
  ]);
});

test("each entry shows only with its own grant", () => {
  assert.deepEqual(moreMenuActions({ offerArchive: false, canDelete: true }), [
    "delete",
  ]);
  assert.deepEqual(moreMenuActions({ offerArchive: true, canDelete: false }), [
    "archive",
  ]);
  assert.deepEqual(
    moreMenuActions({ offerArchive: false, canDelete: false }),
    []
  );
});

// ── Refusal messages ─────────────────────────────────────

test("a server without the route says archiving isn't available", () => {
  // No mobile error envelope: the 404 is the router's, not the service's.
  assert.equal(
    archiveFailureMessage({
      data: null,
      error: "Server error (404)",
      errorDetails: null,
      status: 404,
    }),
    ARCHIVE_UNAVAILABLE_MESSAGE
  );
});

test("a 404 with the envelope is the service's 'not found', shown as is", () => {
  const message =
    "This asset does not exist or does not belong to your workspace.";
  assert.equal(
    archiveFailureMessage({
      data: null,
      error: message,
      errorDetails: { message },
      status: 404,
    }),
    message
  );
});

test("any other refusal shows the server's message", () => {
  const message =
    "This asset is in a reserved or checked-out booking. Remove it from that booking, then archive it.";
  assert.equal(
    archiveFailureMessage({
      data: null,
      error: message,
      errorDetails: { message },
      status: 400,
    }),
    message
  );
});

// ── The "Archive anyway" flow ────────────────────────────

type Archived = { asset: { id: string } };

const archived: ArchiveAnswer<Archived> = {
  data: { asset: { id: "asset-1" } },
  error: null,
};

const shortfallMessage =
  'Archiving would leave model reservations short: "ZZ Shoot" (1 ZZ Camera unit short). Those bookings can\'t fill their model reservations for their dates until the reservations are reduced. Archive anyway?';

const shortfall: ArchiveAnswer<Archived> = {
  data: null,
  error: shortfallMessage,
  errorDetails: { message: shortfallMessage, reason: "model_shortfall" },
  status: 409,
};

/** A fake `send` that answers in turn and records each confirm flag. */
function sender(answers: ArchiveAnswer<Archived>[]) {
  const sent: boolean[] = [];
  const send = async (confirm: boolean) => {
    sent.push(confirm);
    const answer = answers.shift();
    assert.ok(answer, "sent more requests than expected");
    return answer;
  };
  return { send, sent };
}

test("archives on the first request when nothing falls short", async () => {
  const { send, sent } = sender([archived]);
  let asked = false;

  const outcome = await runArchive({
    send,
    confirmShortfall: async () => {
      asked = true;
      return true;
    },
  });

  assert.deepEqual(outcome, { kind: "archived", data: archived.data });
  assert.deepEqual(sent, [false]);
  assert.equal(asked, false);
});

test("on the shortfall warning, asks with the server's words and resends confirmed", async () => {
  const { send, sent } = sender([shortfall, archived]);
  let shown = "";

  const outcome = await runArchive({
    send,
    confirmShortfall: async (message) => {
      shown = message;
      return true;
    },
  });

  assert.equal(shown, shortfallMessage);
  assert.deepEqual(sent, [false, true]);
  assert.equal(outcome.kind, "archived");
});

test("declining 'Archive anyway' sends nothing more", async () => {
  const { send, sent } = sender([shortfall]);

  const outcome = await runArchive({
    send,
    confirmShortfall: async () => false,
  });

  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.deepEqual(sent, [false]);
});

test("a shortfall-shaped message without the reason is a plain refusal", async () => {
  // The app keys on the reason field, never on the English text.
  const { send, sent } = sender([
    { ...shortfall, errorDetails: { message: shortfallMessage } },
  ]);

  const outcome = await runArchive({
    send,
    confirmShortfall: async () => true,
  });

  assert.deepEqual(outcome, { kind: "failed", message: shortfallMessage });
  assert.deepEqual(sent, [false]);
});

test("a refusal of the confirmed resend is shown as is", async () => {
  const raced =
    "The asset's status changed before it could be archived. Please refresh and try again.";
  const { send } = sender([
    shortfall,
    {
      data: null,
      error: raced,
      errorDetails: { message: raced },
      status: 409,
    },
  ]);

  const outcome = await runArchive({
    send,
    confirmShortfall: async () => true,
  });

  assert.deepEqual(outcome, { kind: "failed", message: raced });
});

// ── After the change lands ───────────────────────────────

test("an archive or reinstate tells the list and other stacks, then reloads", async () => {
  const before = assetChangeVersion("asset-settle");
  let refetched = 0;

  await settleArchiveChange("asset-settle", async () => {
    refetched += 1;
  });

  // The assets list refetches on its next focus instead of showing the old row.
  assert.notEqual(assetChangeVersion("asset-settle"), before);
  assert.equal(refetched, 1);
});
