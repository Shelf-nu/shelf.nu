/**
 * Tests for scanned-code routing: which lookup a value goes to, and what the
 * scan ends up as once the lookups have answered.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./qr-utils.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  claimableQrId,
  extractQrId,
  isAlreadyScannedQr,
  planScan,
  runScanPlan,
  scanMissFeedback,
  type ScanLookupAnswer,
} from "./qr-utils";

const ACTIVE = "https://app.shelf.nu";
/** A dedicated server, for the rows where the app is connected to one. */
const DEDICATED = "https://shelf.dedicated.example";
/** The Shelf servers the app can name: its bundled Shelf Cloud default. */
const KNOWN_SERVERS = [ACTIVE];
/** A QR id in the shape the shortener regex accepts: 10-25 lowercase alnum. */
const ID = "abcdefghij";

// ── extractQrId ──────────────────────────────────────────

test("extractQrId reads all three supported formats", () => {
  assert.equal(extractQrId(`${ACTIVE}/qr/${ID}`), ID);
  assert.equal(extractQrId(`https://eam.sh/${ID}`), ID);
  assert.equal(extractQrId(ID), ID);
});

test("extractQrId returns null for anything that isn't a Shelf code", () => {
  for (const input of ["", "https://example.com/", "hello world", "12345"]) {
    assert.equal(extractQrId(input), null, JSON.stringify(input));
  }
});

// ── A stand-in server ────────────────────────────────────

/** Outside labels; `other-vendor.example` is a previous system's host. */
const OUTSIDE_QR = "http://other-vendor.example/qr/a1B2c3D4";
const OUTSIDE_SHORT = "https://other-vendor.example/k3x9q2m7ab";
const OUTSIDE_BARE = "k3x9q2m7ab";
const OTHER_SHELF = `https://other-shelf.example/qr/${ID}`;

/** What the stand-in workspace holds. */
const SERVER = {
  /** Ids the QR route resolves: one QR id and one SAM id. */
  qrIds: new Set([ID, "SAM-0001"]),
  /** A QR that exists but belongs to no workspace yet. */
  unclaimedQrIds: new Set(["unclaimed0"]),
  /** Barcode values linked to an asset or kit, stored as scanned. */
  barcodes: new Set([OUTSIDE_QR, OUTSIDE_SHORT, OUTSIDE_BARE, "4006381333931"]),
  /** Barcodes that exist but are linked to nothing (422). */
  unlinkedBarcodes: new Set([
    "http://other-vendor.example/qr/unlinked1",
    "https://other-vendor.example/unlinked001",
  ]),
  /** A barcode held by more than one of the caller's workspaces (409). */
  ambiguousBarcodes: new Set(["twoworkspaces"]),
  /** A QR that belongs to a workspace the caller is not in (403). */
  forbiddenQrIds: new Set(["forbidden00"]),
  /** A value something in front of the server answers 404 for. */
  proxyRejected: new Set(["http://other-vendor.example/qr/proxied1"]),
  /** Values the barcode route refuses outright (403). */
  forbiddenBarcodes: new Set([
    "http://other-vendor.example/qr/refused1",
    "refusedcode",
  ]),
  /** A value whose barcode request gets no answer (network failure). */
  unreachableBarcodes: new Set(["noanswercode"]),
  /** A barcode held by a workspace of the caller's that is inactive (403). */
  inactiveWorkspaceBarcodes: new Set(["inactivecode"]),
};

type Answer = ScanLookupAnswer & { data: string | null; error?: string };

/**
 * Lookups that answer the way the mobile routes do, and record what was asked
 * so a row can pin the order of the calls.
 *
 * why: stands in for the network. A plain not-found here is a 404 with the
 * API's error envelope and no `reason`; `mobile.barcode.test.ts` pins that
 * the barcode route answers in exactly that shape.
 */
function fakeLookups(options: { offline?: boolean } = {}) {
  const calls: string[] = [];
  const offline: Answer = { data: null, error: "Network error" };
  return {
    calls,
    qr: (id: string): Promise<Answer> => {
      calls.push(`qr:${id}`);
      if (options.offline) return Promise.resolve(offline);
      if (SERVER.qrIds.has(id)) return Promise.resolve({ data: `qr:${id}` });
      if (SERVER.forbiddenQrIds.has(id)) {
        return Promise.resolve({ data: null, error: "forbidden", status: 403 });
      }
      return Promise.resolve({
        data: null,
        error: "QR code not found",
        status: 404,
        errorDetails: SERVER.unclaimedQrIds.has(id)
          ? { reason: "unclaimed" }
          : {},
      });
    },
    barcode: (value: string): Promise<Answer> => {
      calls.push(`barcode:${value}`);
      if (options.offline) return Promise.resolve(offline);
      if (SERVER.barcodes.has(value)) {
        return Promise.resolve({ data: `barcode:${value}` });
      }
      const status = SERVER.unlinkedBarcodes.has(value)
        ? 422
        : SERVER.ambiguousBarcodes.has(value)
        ? 409
        : SERVER.forbiddenBarcodes.has(value) ||
          SERVER.inactiveWorkspaceBarcodes.has(value)
        ? 403
        : 404;
      if (SERVER.unreachableBarcodes.has(value)) {
        return Promise.resolve(offline);
      }
      if (SERVER.proxyRejected.has(value)) {
        // A 404 that is not the API's envelope: no errorDetails.
        return Promise.resolve({ data: null, error: "refused", status: 404 });
      }
      return Promise.resolve({
        data: null,
        error: "refused",
        status,
        errorDetails: SERVER.inactiveWorkspaceBarcodes.has(value)
          ? { reason: "workspace_inactive" }
          : {},
      });
    },
  };
}

// ── One row per input class ──────────────────────────────

type Row = {
  name: string;
  input: string;
  /** Whether the workspace can resolve barcodes. Defaults to true. */
  barcodes?: boolean;
  /** The server the app is connected to. Defaults to Shelf Cloud. */
  active?: string;
  /** The lookups asked, in order. */
  calls: string[];
  /** How the scan ends: which answer the screen renders. */
  outcome:
    | { kind: "qr"; found: boolean }
    | { kind: "barcode"; found: boolean }
    | { kind: "outside-link-miss"; lookedUp: boolean; shelfServer: boolean }
    | { kind: "barcodes-unavailable" };
};

const ROWS: Row[] = [
  {
    name: "Shelf app link",
    input: `${ACTIVE}/qr/${ID}`,
    calls: [`qr:${ID}`],
    outcome: { kind: "qr", found: true },
  },
  {
    name: "Shelf app link the server does not know",
    input: `${ACTIVE}/qr/missing000`,
    // This server minted the link, so a miss is final: it is no barcode.
    calls: ["qr:missing000"],
    outcome: { kind: "qr", found: false },
  },
  {
    name: "shortener link",
    input: `https://eam.sh/${ID}`,
    calls: [`qr:${ID}`],
    outcome: { kind: "qr", found: true },
  },
  {
    name: "self-hosted shortener link, barcodes off",
    input: `https://acme.link/${ID}`,
    barcodes: false,
    calls: [`qr:${ID}`],
    outcome: { kind: "qr", found: true },
  },
  {
    name: "raw qr id",
    input: ID,
    calls: [`qr:${ID}`],
    outcome: { kind: "qr", found: true },
  },
  {
    name: "unclaimed Shelf short link",
    input: "https://eam.sh/unclaimed0",
    // The QR route knows the code, so the claim flow keeps its answer.
    calls: ["qr:unclaimed0"],
    outcome: { kind: "qr", found: false },
  },
  {
    name: "Shelf Cloud link, scanned while on a dedicated server",
    input: `${ACTIVE}/qr/${ID}`,
    active: DEDICATED,
    // Still looked up first: it may have been linked here as a barcode.
    // The miss names the other server, because the app knows that host.
    calls: [`barcode:${ACTIVE}/qr/${ID}`],
    outcome: { kind: "outside-link-miss", lookedUp: true, shelfServer: true },
  },
  {
    name: "Shelf Cloud link on a dedicated server, barcodes off",
    input: `${ACTIVE}/qr/${ID}`,
    active: DEDICATED,
    barcodes: false,
    calls: [],
    outcome: { kind: "outside-link-miss", lookedUp: false, shelfServer: true },
  },
  {
    name: "dedicated server's own link, scanned on that server",
    input: `${DEDICATED}/qr/${ID}`,
    active: DEDICATED,
    calls: [`qr:${ID}`],
    outcome: { kind: "qr", found: true },
  },
  {
    name: "link on a Shelf server the app cannot name",
    input: OTHER_SHELF,
    calls: [`barcode:${OTHER_SHELF}`],
    outcome: { kind: "outside-link-miss", lookedUp: true, shelfServer: false },
  },
  {
    name: "link on a Shelf server the app cannot name, barcodes off",
    input: OTHER_SHELF,
    barcodes: false,
    // Nothing was asked, so the screen must not claim a search happened.
    calls: [],
    outcome: { kind: "outside-link-miss", lookedUp: false, shelfServer: false },
  },
  {
    name: "outside /qr/ url linked as ExternalQR",
    input: OUTSIDE_QR,
    // Full value, case kept, and never the tail on the QR route.
    calls: [`barcode:${OUTSIDE_QR}`],
    outcome: { kind: "barcode", found: true },
  },
  {
    name: "outside /qr/ url that is not linked",
    input: "http://other-vendor.example/qr/zzzz9999",
    calls: ["barcode:http://other-vendor.example/qr/zzzz9999"],
    outcome: { kind: "outside-link-miss", lookedUp: true, shelfServer: false },
  },
  {
    name: "outside /qr/ url linked to nothing",
    input: "http://other-vendor.example/qr/unlinked1",
    // 422 says more than "not found", so the server's answer is shown.
    calls: ["barcode:http://other-vendor.example/qr/unlinked1"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "outside short-link-shaped url linked as ExternalQR",
    input: OUTSIDE_SHORT,
    calls: ["qr:k3x9q2m7ab", `barcode:${OUTSIDE_SHORT}`],
    outcome: { kind: "barcode", found: true },
  },
  {
    name: "outside bare lowercase value linked as a barcode",
    input: OUTSIDE_BARE,
    calls: ["qr:k3x9q2m7ab", `barcode:${OUTSIDE_BARE}`],
    outcome: { kind: "barcode", found: true },
  },
  {
    name: "outside /qr/ url answered 404 by a proxy, not the API",
    input: "http://other-vendor.example/qr/proxied1",
    // Not the API's "not found", so the label may well be linked.
    calls: ["barcode:http://other-vendor.example/qr/proxied1"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "outside /qr/ url the barcode route refuses",
    input: "http://other-vendor.example/qr/refused1",
    // Only a plain not-found reads as a miss; a 403 keeps its own message.
    calls: ["barcode:http://other-vendor.example/qr/refused1"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "short-link-shaped url that is a barcode linked to nothing",
    input: "https://other-vendor.example/unlinked001",
    // 422 knows the value, so it replaces the QR route's "not found".
    calls: [
      "qr:unlinked001",
      "barcode:https://other-vendor.example/unlinked001",
    ],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "bare value held as a barcode by two workspaces",
    input: "twoworkspaces",
    // 409 knows the value too.
    calls: ["qr:twoworkspaces", "barcode:twoworkspaces"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "bare value whose barcode lookup gets no answer",
    input: "noanswercode",
    // The QR route said not found, but the barcode lookup failed: show that
    // failure, not a "not found" the app cannot stand behind.
    calls: ["qr:noanswercode", "barcode:noanswercode"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "bare value the barcode route refuses",
    input: "refusedcode",
    // A 403 says nothing about the value, so the QR route's answer stays.
    calls: ["qr:refusedcode", "barcode:refusedcode"],
    outcome: { kind: "qr", found: false },
  },
  {
    name: "bare value held by an inactive workspace of the user's",
    input: "inactivecode",
    // The barcode route found the code and named why it cannot open it, so
    // that answer is shown, not the QR route's "not found".
    calls: ["qr:inactivecode", "barcode:inactivecode"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "short link to a QR in a workspace the user is not in",
    input: "https://eam.sh/forbidden00",
    // 403 is not "not found": the QR route knows the code, so no fallback.
    calls: ["qr:forbidden00"],
    outcome: { kind: "qr", found: false },
  },
  {
    name: "short-link-shaped url nobody knows",
    input: "https://other-vendor.example/nobodyknows",
    // Both miss: the QR route's answer stays, as for any unknown Shelf code.
    calls: [
      "qr:nobodyknows",
      "barcode:https://other-vendor.example/nobodyknows",
    ],
    outcome: { kind: "qr", found: false },
  },
  {
    name: "short-link-shaped url nobody knows, barcodes off",
    input: "https://other-vendor.example/nobodyknows",
    barcodes: false,
    calls: ["qr:nobodyknows"],
    outcome: { kind: "qr", found: false },
  },
  {
    name: "outside url of another shape",
    input: "https://other-vendor.example/item/42",
    calls: ["barcode:https://other-vendor.example/item/42"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "plain barcode (EAN-13)",
    input: "4006381333931",
    calls: ["barcode:4006381333931"],
    outcome: { kind: "barcode", found: true },
  },
  {
    name: "plain barcode nobody knows",
    input: "ABC-123/x",
    calls: ["barcode:ABC-123/x"],
    outcome: { kind: "barcode", found: false },
  },
  {
    name: "plain barcode, barcodes off",
    input: "4006381333931",
    barcodes: false,
    calls: [],
    outcome: { kind: "barcodes-unavailable" },
  },
  {
    name: "SAM id",
    input: "sam-0001",
    barcodes: false,
    // Normalized, and resolved on the QR route (not gated on barcodes).
    calls: ["qr:SAM-0001"],
    outcome: { kind: "qr", found: true },
  },
];

for (const row of ROWS) {
  test(`scan: ${row.name}`, async () => {
    const lookups = fakeLookups();
    const servers = { active: row.active ?? ACTIVE, known: KNOWN_SERVERS };
    const plan = planScan(row.input, servers, {
      barcodes: row.barcodes ?? true,
      sequentialIds: true,
    });
    const outcome = await runScanPlan(plan, row.input, lookups);

    assert.deepEqual(lookups.calls, row.calls);
    assert.equal(outcome.kind, row.outcome.kind);
    if (outcome.kind === "outside-link-miss") {
      assert.deepEqual(outcome, row.outcome);
    }
    if ("answer" in outcome && "found" in row.outcome) {
      assert.equal(outcome.answer.data !== null, row.outcome.found);
    }
  });
}

// ── Rules the table cannot show ──────────────────────────

const SERVERS = { active: ACTIVE, known: KNOWN_SERVERS };

test("regression: a linked outside /qr/ url resolves through the barcode lookup", async () => {
  const lookups = fakeLookups();
  const plan = planScan(OUTSIDE_QR, SERVERS, {
    barcodes: true,
    sequentialIds: true,
  });
  const outcome = await runScanPlan(plan, OUTSIDE_QR, lookups);

  assert.deepEqual(outcome, {
    kind: "barcode",
    answer: { data: `barcode:${OUTSIDE_QR}` },
  });
});

test("planScan names the QR id only for a Shelf QR code", () => {
  const options = { barcodes: true, sequentialIds: true };
  // The screens offer the claim and link flows on `qrId`; a SAM id or a
  // barcode must never look like one.
  assert.equal(planScan(`https://eam.sh/${ID}`, SERVERS, options).qrId, ID);
  assert.equal(planScan("SAM-0001", SERVERS, options).qrId, null);
  assert.equal(planScan(OUTSIDE_QR, SERVERS, options).qrId, null);
  assert.equal(planScan("4006381333931", SERVERS, options).qrId, null);
});

test("planScan treats a SAM-shaped value as a barcode without a workspace", () => {
  // SAM ids are unique per workspace, so with none selected the QR route
  // cannot resolve one.
  const plan = planScan("SAM-0001", SERVERS, {
    barcodes: false,
    sequentialIds: false,
  });
  assert.deepEqual(plan, {
    first: "none",
    qrId: null,
    outsideLink: false,
    shelfServer: false,
  });
});

test("runScanPlan keeps the QR route's answer when the fallback gets no answer", async () => {
  // Offline: neither lookup answers, so nothing says "not found" and the
  // barcode lookup is not tried on top of a failed QR request.
  const lookups = fakeLookups({ offline: true });
  const plan = planScan(OUTSIDE_SHORT, SERVERS, {
    barcodes: true,
    sequentialIds: true,
  });
  const outcome = await runScanPlan(plan, OUTSIDE_SHORT, lookups);

  assert.deepEqual(lookups.calls, ["qr:k3x9q2m7ab"]);
  assert.deepEqual(outcome, {
    kind: "qr",
    lookupId: "k3x9q2m7ab",
    answer: { data: null, error: "Network error" },
  });
});

test("runScanPlan shows the server's answer for an outside link when offline", async () => {
  // No answer is not a miss: the label may well be linked.
  const lookups = fakeLookups({ offline: true });
  const plan = planScan(OUTSIDE_QR, SERVERS, {
    barcodes: true,
    sequentialIds: true,
  });
  const outcome = await runScanPlan(plan, OUTSIDE_QR, lookups);

  assert.equal(outcome.kind, "barcode");
});

// ── What the screens build on an outcome ─────────────────

/** Plans and runs a value the way both scanner screens do. */
async function scan(input: string, barcodes = true) {
  const plan = planScan(input, SERVERS, { barcodes, sequentialIds: true });
  const outcome = await runScanPlan(plan, input, fakeLookups());
  return { plan, outcome };
}

test("claimableQrId offers the claim flow only when the QR route's answer is rendered", async () => {
  // A Shelf QR, found or unclaimed: the QR route answered.
  const shelf = await scan(`${ACTIVE}/qr/${ID}`);
  assert.equal(claimableQrId(shelf.plan, shelf.outcome), ID);
  const unclaimed = await scan("unclaimed0");
  assert.equal(claimableQrId(unclaimed.plan, unclaimed.outcome), "unclaimed0");

  // A Shelf-shaped value that resolved through the barcode fallback is a
  // barcode, not a QR: no claim.
  const fallback = await scan(OUTSIDE_BARE);
  assert.equal(fallback.plan.qrId, OUTSIDE_BARE);
  assert.equal(fallback.outcome.kind, "barcode");
  assert.equal(claimableQrId(fallback.plan, fallback.outcome), null);

  // A SAM id goes to the QR route but is not a QR.
  const sam = await scan("SAM-0001");
  assert.equal(claimableQrId(sam.plan, sam.outcome), null);
});

test("isAlreadyScannedQr rejects a QR-route value that is already in the batch list", () => {
  const options = { barcodes: true, sequentialIds: true };
  const listed = [ID, "SAM-0001", null, undefined];

  assert.equal(
    isAlreadyScannedQr(
      planScan(`${ACTIVE}/qr/${ID}`, SERVERS, options),
      listed
    ),
    true
  );
  assert.equal(
    isAlreadyScannedQr(planScan("sam-0001", SERVERS, options), listed),
    true
  );
  assert.equal(
    isAlreadyScannedQr(planScan("othercode1", SERVERS, options), listed),
    false
  );
  // A value bound for the barcode lookup has no QR id to match before it
  // resolves, even when its text equals a listed one.
  assert.equal(
    isAlreadyScannedQr(planScan("4006381333931", SERVERS, options), [
      "4006381333931",
    ]),
    false
  );
});

test("scanMissFeedback covers every outcome that has no answer to render", () => {
  const cases = [
    scanMissFeedback({ kind: "barcodes-unavailable" }, { hasWorkspace: true }),
    scanMissFeedback({ kind: "barcodes-unavailable" }, { hasWorkspace: false }),
    scanMissFeedback(
      { kind: "outside-link-miss", lookedUp: true, shelfServer: true },
      { hasWorkspace: true }
    ),
    scanMissFeedback(
      { kind: "outside-link-miss", lookedUp: true, shelfServer: false },
      { hasWorkspace: true }
    ),
    scanMissFeedback(
      { kind: "outside-link-miss", lookedUp: false, shelfServer: false },
      { hasWorkspace: true }
    ),
  ];

  assert.deepEqual(
    cases.map((feedback) => [feedback.tone, feedback.title]),
    [
      ["not_found", "Barcode Not Supported"],
      ["not_found", "Code Not Recognized"],
      ["error", "Different Shelf Server"],
      ["not_found", "Code Not Found"],
      ["not_found", "Code Not Found"],
    ]
  );
  // The audit toast shows its subtitle on one line, so its short text must
  // fit a phone-width line and still carry the action.
  for (const feedback of cases) {
    assert.ok(
      feedback.shortMessage.length <= 36,
      `${feedback.title}: "${feedback.shortMessage}" is too long for a toast`
    );
  }
  assert.deepEqual(
    cases.map((feedback) => feedback.shortMessage),
    [
      "Ask your admin to enable barcodes.",
      "Not a Shelf asset code.",
      "Sign in to that server to use it.",
      "Other Shelf server? Sign in there.",
      "Not a code from this Shelf server.",
    ]
  );
  // The screen reader hears the same action the toast shows.
  assert.match(cases[0].announcement, /ask your admin/i);
  assert.match(cases[3].announcement, /another Shelf server/);
  // A search is claimed only when the barcode lookup was asked.
  assert.match(cases[3].message, /not found in your workspaces/);
  assert.match(cases[4].message, /not a code from this Shelf server/);
});

test("scanMissFeedback follows each outside-link miss from the stand-in server", async () => {
  // Linked to nothing anywhere, barcodes on: the lookup was asked.
  const unknown = await scan("https://other-vendor.example/qr/nolink1");
  assert.equal(unknown.outcome.kind, "outside-link-miss");
  if (unknown.outcome.kind !== "outside-link-miss") return;
  assert.match(
    scanMissFeedback(unknown.outcome, { hasWorkspace: true }).message,
    /not found in your workspaces/
  );

  // Barcodes off: nothing could be looked up.
  const off = await scan("https://other-vendor.example/qr/nolink1", false);
  assert.equal(off.outcome.kind, "outside-link-miss");
  if (off.outcome.kind !== "outside-link-miss") return;
  assert.match(
    scanMissFeedback(off.outcome, { hasWorkspace: true }).message,
    /not a code from this Shelf server/
  );
});
