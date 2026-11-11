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
  extractQrId,
  planScan,
  runScanPlan,
  type ScanLookupAnswer,
} from "./qr-utils";

const ACTIVE = "https://app.shelf.nu";
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
  /** A barcode that exists but is linked to nothing (422). */
  unlinkedBarcodes: new Set(["http://other-vendor.example/qr/unlinked1"]),
};

type Answer = ScanLookupAnswer & { data: string | null; error?: string };

/**
 * Lookups that answer the way the mobile routes do, and record what was asked
 * so a row can pin the order of the calls.
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
      return Promise.resolve({
        data: null,
        error: "QR code not found",
        status: 404,
        errorDetails: SERVER.unclaimedQrIds.has(id)
          ? { reason: "unclaimed" }
          : null,
      });
    },
    barcode: (value: string): Promise<Answer> => {
      calls.push(`barcode:${value}`);
      if (options.offline) return Promise.resolve(offline);
      if (SERVER.barcodes.has(value)) {
        return Promise.resolve({ data: `barcode:${value}` });
      }
      return Promise.resolve({
        data: null,
        error: "not found",
        status: SERVER.unlinkedBarcodes.has(value) ? 422 : 404,
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
  /** The lookups asked, in order. */
  calls: string[];
  /** How the scan ends: which answer the screen renders. */
  outcome:
    | { kind: "qr"; found: boolean }
    | { kind: "barcode"; found: boolean }
    | { kind: "outside-link-miss" };
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
    name: "our link on a different Shelf server",
    input: OTHER_SHELF,
    calls: [`barcode:${OTHER_SHELF}`],
    outcome: { kind: "outside-link-miss" },
  },
  {
    name: "our link on a different Shelf server, barcodes off",
    input: OTHER_SHELF,
    barcodes: false,
    calls: [],
    outcome: { kind: "outside-link-miss" },
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
    outcome: { kind: "outside-link-miss" },
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
    const plan = planScan(row.input, ACTIVE, {
      barcodes: row.barcodes ?? true,
      sequentialIds: true,
    });
    const outcome = await runScanPlan(plan, row.input, lookups);

    assert.deepEqual(lookups.calls, row.calls);
    assert.equal(outcome.kind, row.outcome.kind);
    if (outcome.kind !== "outside-link-miss" && "found" in row.outcome) {
      assert.equal(outcome.answer.data !== null, row.outcome.found);
    }
  });
}

// ── Rules the table cannot show ──────────────────────────

test("regression: a linked outside /qr/ url resolves through the barcode lookup", async () => {
  const lookups = fakeLookups();
  const plan = planScan(OUTSIDE_QR, ACTIVE, {
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
  assert.equal(planScan(`https://eam.sh/${ID}`, ACTIVE, options).qrId, ID);
  assert.equal(planScan("SAM-0001", ACTIVE, options).qrId, null);
  assert.equal(planScan(OUTSIDE_QR, ACTIVE, options).qrId, null);
  assert.equal(planScan("4006381333931", ACTIVE, options).qrId, null);
});

test("planScan sends a SAM-shaped value to the barcode lookup without a workspace", () => {
  // SAM ids are unique per workspace, so with none selected the QR route
  // cannot resolve one.
  const plan = planScan("SAM-0001", ACTIVE, {
    barcodes: false,
    sequentialIds: false,
  });
  assert.equal(plan.first, "barcode");
});

test("runScanPlan keeps the QR route's answer when the fallback gets no answer", async () => {
  // Offline: neither lookup answers, so nothing says "not found" and the
  // barcode lookup is not tried on top of a failed QR request.
  const lookups = fakeLookups({ offline: true });
  const plan = planScan(OUTSIDE_SHORT, ACTIVE, {
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
  const plan = planScan(OUTSIDE_QR, ACTIVE, {
    barcodes: true,
    sequentialIds: true,
  });
  const outcome = await runScanPlan(plan, OUTSIDE_QR, lookups);

  assert.equal(outcome.kind, "barcode");
});
