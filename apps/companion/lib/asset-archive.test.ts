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
  runReinstate,
  UNCONFIRMED_NOTE,
  UNCONFIRMED_TITLE,
  failureTitle,
  captureRequestScope,
  landArchiveChange,
  type ArchiveChangeResult,
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
    isStillHere: () => true,
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
    isStillHere: () => true,
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
    isStillHere: () => true,
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
    isStillHere: () => true,
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
    isStillHere: () => true,
    confirmShortfall: async () => true,
  });

  assert.deepEqual(outcome, { kind: "failed", message: raced });
});

// ── After the change lands ───────────────────────────────

test("the screen moved while the first confirm was open: nothing is sent", async () => {
  const { send, sent } = sender([archived]);

  const outcome = await runArchive({
    send,
    // Captured as the confirm opened; a deep link moved the screen since.
    isStillHere: () => false,
    confirmShortfall: async () => true,
  });

  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.deepEqual(sent, []);
});

test("the screen moved before the shortfall prompt: no prompt, nothing resent", async () => {
  const answers = sender([shortfall]);
  const sent = answers.sent;
  let here = true;
  const send = async (confirm: boolean) => {
    const answer = await answers.send(confirm);
    here = false; // a deep link opened another asset while the request ran
    return answer;
  };
  let asked = false;

  const outcome = await runArchive({
    send,
    isStillHere: () => here,
    confirmShortfall: async () => {
      asked = true;
      return true;
    },
  });

  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.equal(asked, false);
  assert.deepEqual(sent, [false]);
});

test("the screen moved while the prompt was open: a confirm sends nothing", async () => {
  const { send, sent } = sender([shortfall, archived]);
  let here = true;

  const outcome = await runArchive({
    send,
    isStillHere: () => here,
    confirmShortfall: async () => {
      here = false; // a deep link opened another asset behind the prompt
      return true;
    },
  });

  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.deepEqual(sent, [false]);
});

// ── No answer from the server ────────────────────────────

/** What `apiFetch` answers for a timed-out request: no HTTP status. */
const timedOut: ArchiveAnswer<Archived> = {
  data: null,
  error: "Request timed out. Check your connection.",
};

test("a timed-out archive is uncertain: it may have landed", async () => {
  const { send } = sender([timedOut]);

  const outcome = await runArchive({
    send,
    isStillHere: () => true,
    confirmShortfall: async () => true,
  });

  assert.deepEqual(outcome, {
    kind: "failed",
    message: `Request timed out. Check your connection. ${UNCONFIRMED_NOTE}`,
    uncertain: true,
  });
});

test("a timed-out confirmed resend is uncertain too", async () => {
  const { send } = sender([shortfall, timedOut]);

  const outcome = await runArchive({
    send,
    isStillHere: () => true,
    confirmShortfall: async () => true,
  });

  assert.equal(outcome.kind === "failed" && outcome.uncertain, true);
});

test("a refusal the server answered is not uncertain", async () => {
  const { send } = sender([
    {
      data: null,
      error: "Refused",
      errorDetails: { message: "Refused" },
      status: 400,
    },
  ]);

  const outcome = await runArchive({
    send,
    isStillHere: () => true,
    confirmShortfall: async () => true,
  });

  assert.deepEqual(outcome, { kind: "failed", message: "Refused" });
});

// ── Reinstate ────────────────────────────────────────────

test("a reinstate confirmed after the screen moved sends nothing", async () => {
  let sent = 0;

  const result = await runReinstate({
    send: async () => {
      sent += 1;
      return { data: { asset: { id: "asset-1" } }, error: null };
    },
    isStillHere: () => false,
  });

  assert.deepEqual(result, { kind: "cancelled" });
  assert.equal(sent, 0);
});

test("a reinstate ends changed, refused, or uncertain without an answer", async () => {
  const run = (answer: ArchiveAnswer<unknown>) =>
    runReinstate({ send: async () => answer, isStillHere: () => true });

  assert.deepEqual(await run({ data: { ok: true }, error: null }), {
    kind: "changed",
    archivedAt: null,
  });
  assert.deepEqual(await run({ data: null, error: "Refused", status: 400 }), {
    kind: "failed",
    message: "Refused",
  });
  assert.deepEqual(await run(timedOut), {
    kind: "failed",
    message: `Request timed out. Check your connection. ${UNCONFIRMED_NOTE}`,
    uncertain: true,
  });
});

// ── Is this still the screen the request started on? ─────

test("the request scope holds while the workspace and asset are unchanged", () => {
  let now = { workspaceId: "ws-1", assetId: "asset-1" };
  const isStillHere = captureRequestScope(() => now);

  assert.equal(isStillHere(), true);

  now = { workspaceId: "ws-2", assetId: "asset-1" };
  assert.equal(isStillHere(), false, "workspace switched");

  now = { workspaceId: "ws-1", assetId: "asset-2" };
  assert.equal(isStillHere(), false, "screen reused for another asset");
});

// ── Landing the answer ───────────────────────────────────

/**
 * Lands a result on a fake screen whose asset starts in `before`, and records
 * every effect that reached it.
 */
async function land(
  result: ArchiveChangeResult,
  {
    assetId,
    before = null,
    here = () => true,
    reloadFails = false,
  }: {
    assetId: string;
    before?: string | null;
    here?: () => boolean;
    reloadFails?: boolean;
  }
) {
  let shown = before;
  const refusals: string[] = [];
  const titles: string[] = [];
  let refetched = 0;
  let changed = 0;
  await landArchiveChange(result, {
    assetId,
    isStillHere: here,
    showRefusal: (failure) => {
      refusals.push(failure.message);
      titles.push(failureTitle(failure, "Couldn't archive"));
    },
    apply: (value) => {
      shown = value;
    },
    refetch: async () => {
      refetched += 1;
      // The screen's quiet reload keeps the asset it has when the GET fails.
      if (!reloadFails && result.kind === "changed") shown = result.archivedAt;
    },
    onChanged: () => {
      changed += 1;
    },
  });
  return { shown, refusals, titles, refetched, changed };
}

const ARCHIVED_AT = "2026-11-16T10:00:00.000Z";

test("an archive tells the list and other stacks, shows it, reloads and confirms", async () => {
  const before = assetChangeVersion("asset-land");

  const result = await land(
    { kind: "changed", archivedAt: ARCHIVED_AT },
    { assetId: "asset-land" }
  );

  // The assets list refetches on its next focus instead of showing the old row.
  assert.notEqual(assetChangeVersion("asset-land"), before);
  assert.equal(result.shown, ARCHIVED_AT);
  assert.equal(result.refetched, 1);
  assert.equal(result.changed, 1);
});

test("a successful archive shows as archived even when the reload fails", async () => {
  const { shown } = await land(
    { kind: "changed", archivedAt: ARCHIVED_AT },
    { assetId: "asset-archived", reloadFails: true }
  );

  // From the archive answer, not from the failed GET.
  assert.equal(shown, ARCHIVED_AT);
});

test("a successful reinstate shows as active even when the reload fails", async () => {
  const { shown } = await land(
    { kind: "changed", archivedAt: null },
    { assetId: "asset-reinstated", before: ARCHIVED_AT, reloadFails: true }
  );

  assert.equal(shown, null);
});

test("a refusal shows its message and reloads the asset", async () => {
  const before = assetChangeVersion("asset-refused");

  const result = await land(
    { kind: "failed", message: "Refused" },
    { assetId: "asset-refused" }
  );

  assert.deepEqual(result.refusals, ["Refused"]);
  assert.deepEqual(result.titles, ["Couldn't archive"]);
  assert.equal(result.refetched, 1);
  // The server answered "no": nothing changed, so nothing is marked.
  assert.equal(assetChangeVersion("asset-refused"), before);
});

test("a request without an answer claims neither failure nor a finished reload", async () => {
  const result = await land(
    {
      kind: "failed",
      message: `Timed out. ${UNCONFIRMED_NOTE}`,
      uncertain: true,
    },
    { assetId: "asset-uncertain-words", reloadFails: true }
  );

  // Shown before the reload runs, and the reload can fail too.
  assert.deepEqual(result.titles, [UNCONFIRMED_TITLE]);
  assert.doesNotMatch(UNCONFIRMED_NOTE, /\b(was|has been) reloaded\b/);
  assert.doesNotMatch(UNCONFIRMED_TITLE, /couldn't/i);
  assert.equal(result.refetched, 1);
});

test("an uncertain failure marks the asset changed, here or not", async () => {
  for (const [assetId, here] of [
    ["asset-uncertain-here", () => true],
    ["asset-uncertain-moved", () => false],
  ] as const) {
    const before = assetChangeVersion(assetId);

    await land(
      { kind: "failed", message: "Timed out", uncertain: true },
      { assetId, here }
    );

    // The list, and this detail on its next focus, refetch until a reload
    // shows whether the change landed.
    assert.notEqual(assetChangeVersion(assetId), before, assetId);
  }
});

/**
 * A request scope captured on "asset-1" in "ws-1", then moved the way the
 * screen moves while the request runs.
 */
function movedScope(moved: { workspaceId: string; assetId: string }) {
  let now = { workspaceId: "ws-1", assetId: "asset-1" };
  const isStillHere = captureRequestScope(() => now);
  now = moved;
  return isStillHere;
}

for (const [why, here] of [
  [
    "the workspace switched",
    movedScope({ workspaceId: "ws-2", assetId: "asset-1" }),
  ],
  [
    "the screen now shows another asset",
    movedScope({ workspaceId: "ws-1", assetId: "asset-2" }),
  ],
] as const) {
  test(`after a change, nothing lands when ${why}`, async () => {
    const before = assetChangeVersion("asset-moved");

    const result = await land(
      { kind: "changed", archivedAt: ARCHIVED_AT },
      { assetId: "asset-moved", here }
    );

    // Nothing reaches what the screen shows now...
    assert.equal(result.shown, null);
    assert.equal(result.refetched, 0);
    assert.equal(result.changed, 0);
    // ...but the changed asset's list row still refreshes.
    assert.notEqual(assetChangeVersion("asset-moved"), before);
  });

  test(`a refusal lands nothing when ${why}`, async () => {
    const result = await land(
      { kind: "failed", message: "Refused" },
      { assetId: "asset-moved-refused", here }
    );

    assert.deepEqual(result.refusals, []);
    assert.equal(result.refetched, 0);
  });
}

test("a screen that moves during the reload gets no success note", async () => {
  let reloads = 0;
  let here = true;
  let changed = 0;

  await landArchiveChange(
    { kind: "changed", archivedAt: ARCHIVED_AT },
    {
      assetId: "asset-moved-late",
      isStillHere: () => here,
      showRefusal: () => {},
      apply: () => {},
      refetch: async () => {
        reloads += 1;
        here = false; // a deep link opened another asset meanwhile
      },
      onChanged: () => {
        changed += 1;
      },
    }
  );

  assert.equal(reloads, 1);
  assert.equal(changed, 0);
});
