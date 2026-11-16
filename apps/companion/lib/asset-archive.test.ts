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

test("every status the server refuses is blocked before the tap", () => {
  // Marked in custody with no custody row in the payload, and no kit in use.
  assert.equal(
    archiveBlockedReason({ ...available, status: "IN_CUSTODY" }, false),
    "Check the asset in and release any custody before archiving it."
  );
  for (const status of ["IN_CUSTODY", "CHECKED_OUT"]) {
    assert.notEqual(
      archiveBlockedReason({ ...available, status }, false),
      null,
      status
    );
  }
});

test("a member in custody through its kit gets the kit's reason, as on the web", () => {
  assert.equal(
    archiveBlockedReason(
      { ...available, status: "IN_CUSTODY", kit: { status: "IN_CUSTODY" } },
      false
    ),
    "This asset is part of a kit that's currently in use."
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

test("a POST the server's catch-all route answers (405, HTML) says the same", () => {
  // What a server without the route answers: its catch-all page has no action.
  assert.equal(
    archiveFailureMessage({
      data: null,
      error: "Server error (405)",
      errorDetails: null,
      status: 405,
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

/**
 * Runs `settleArchiveChange` against a fake screen whose asset starts in the
 * state before the change (`before`) and returns what the screen shows after.
 */
async function settle({
  assetId,
  archivedAt,
  before,
  current = true,
  reloadFails = false,
}: {
  assetId: string;
  archivedAt: string | null;
  before: string | null;
  current?: boolean;
  reloadFails?: boolean;
}) {
  let shown = before;
  let refetched = 0;
  await settleArchiveChange({
    assetId,
    archivedAt,
    apply: (value) => {
      shown = value;
    },
    refetch: async () => {
      refetched += 1;
      // The screen's quiet reload keeps the asset it has when the GET fails.
      if (!reloadFails) shown = archivedAt;
    },
    isStillCurrent: () => current,
  });
  return { shown, refetched };
}

test("an archive or reinstate tells the list and other stacks, then reloads", async () => {
  const before = assetChangeVersion("asset-settle");

  const { refetched } = await settle({
    assetId: "asset-settle",
    archivedAt: "2026-11-16T10:00:00.000Z",
    before: null,
  });

  // The assets list refetches on its next focus instead of showing the old row.
  assert.notEqual(assetChangeVersion("asset-settle"), before);
  assert.equal(refetched, 1);
});

test("a successful archive shows as archived even when the reload fails", async () => {
  const { shown } = await settle({
    assetId: "asset-archived",
    archivedAt: "2026-11-16T10:00:00.000Z",
    before: null,
    reloadFails: true,
  });

  // From the archive answer, not from the failed GET.
  assert.equal(shown, "2026-11-16T10:00:00.000Z");
});

test("a successful reinstate shows as active even when the reload fails", async () => {
  const { shown } = await settle({
    assetId: "asset-reinstated",
    archivedAt: null,
    before: "2026-11-01T10:00:00.000Z",
    reloadFails: true,
  });

  assert.equal(shown, null);
});

test("after a workspace switch mid-request, nothing lands on the screen", async () => {
  const before = assetChangeVersion("asset-switched");

  const { shown, refetched } = await settle({
    assetId: "asset-switched",
    archivedAt: "2026-11-16T10:00:00.000Z",
    before: null,
    current: false,
  });

  // The old workspace's answer must not replace the new workspace's asset.
  assert.equal(shown, null);
  assert.equal(refetched, 0);
  assert.notEqual(assetChangeVersion("asset-switched"), before);
});
