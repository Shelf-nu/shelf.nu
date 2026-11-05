/**
 * Tests for what a tapped link does: which QR lookup runs, where a QR code
 * leads, and which action each kind of link takes (and when the modal it
 * sits in closes).
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./link-dispatch.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dispatchLinkOpening,
  resolveQrOutcome,
  type LinkEffects,
  type QrLookupResult,
  type QrLookups,
  type QrOutcome,
} from "./link-dispatch";
import type { LinkOpening } from "./open-link";

const CLOUD = "https://app.shelf.nu";

/** Lookups that answer `result` and record which one ran, with what. */
function recordingLookups(result: QrLookupResult | Error) {
  const calls: string[] = [];
  const answer = async () => {
    if (result instanceof Error) throw result;
    return result;
  };
  const lookups: QrLookups = {
    scan: async (qrId) => {
      calls.push(`scan:${qrId}`);
      return answer();
    },
    lookup: async (qrId, orgId) => {
      calls.push(`lookup:${qrId}:${orgId}`);
      return answer();
    },
  };
  return { lookups, calls };
}

const ASSET_QR: QrLookupResult = { data: { qr: { asset: { id: "as_1" } } } };
const KIT_QR: QrLookupResult = {
  data: { qr: { asset: null, kitId: "kit_1" } },
};
const UNRESOLVED: QrLookupResult = { data: null, error: { status: 404 } };

test("a tapped QR link looks the code up without recording a scan", async () => {
  const { lookups, calls } = recordingLookups(ASSET_QR);
  await resolveQrOutcome(
    "qr_1",
    CLOUD,
    CLOUD,
    { recordScan: false, orgId: "org_1" },
    lookups
  );
  assert.deepEqual(calls, ["lookup:qr_1:org_1"]);
});

test("a camera scan records the scan", async () => {
  const { lookups, calls } = recordingLookups(ASSET_QR);
  await resolveQrOutcome("qr_1", CLOUD, CLOUD, {}, lookups);
  assert.deepEqual(calls, ["scan:qr_1"]);
});

test("a QR code on an asset or a kit opens its screen", async () => {
  for (const recordScan of [true, false]) {
    assert.deepEqual(
      await resolveQrOutcome(
        "qr_1",
        CLOUD,
        CLOUD,
        { recordScan },
        recordingLookups(ASSET_QR).lookups
      ),
      { kind: "screen", tabRoot: "/(tabs)/assets", href: "/(tabs)/assets/as_1" }
    );
    assert.deepEqual(
      await resolveQrOutcome(
        "qr_1",
        CLOUD,
        CLOUD,
        { recordScan },
        recordingLookups(KIT_QR).lookups
      ),
      {
        kind: "screen",
        tabRoot: "/(tabs)/assets",
        href: "/(tabs)/assets/kits/kit_1",
      }
    );
  }
});

test("a tapped QR link that does not resolve gets the notice, never the browser", async () => {
  for (const result of [
    UNRESOLVED,
    { data: { qr: {} } },
    new Error("offline"),
  ]) {
    assert.deepEqual(
      await resolveQrOutcome(
        "qr_1",
        CLOUD,
        CLOUD,
        { recordScan: false },
        recordingLookups(result).lookups
      ),
      { kind: "web-only", url: `${CLOUD}/qr/qr_1` }
    );
  }
});

test("a camera scan that does not resolve opens the web QR page", async () => {
  assert.deepEqual(
    await resolveQrOutcome(
      "qr_1",
      undefined,
      CLOUD,
      {},
      recordingLookups(UNRESOLVED).lookups
    ),
    { kind: "browser", url: `${CLOUD}/qr/qr_1` }
  );
});

test("a QR code from another Shelf server opens there without a lookup", async () => {
  const other = "https://assets.example.org";
  for (const recordScan of [true, false]) {
    const { lookups, calls } = recordingLookups(ASSET_QR);
    assert.deepEqual(
      await resolveQrOutcome("qr_1", other, CLOUD, { recordScan }, lookups),
      { kind: "browser", url: `${other}/qr/qr_1` }
    );
    assert.deepEqual(calls, []);
  }
});

/**
 * Effects that log what ran, in order. The QR lookup answers `qrOutcome`.
 */
function loggingEffects(qrOutcome?: QrOutcome) {
  const log: string[] = [];
  const effects: LinkEffects = {
    leave: () => {
      log.push("leave");
    },
    openScreen: ({ href }) => log.push(`screen:${href}`),
    resolveQr: async (qrId) => {
      log.push(`qr:${qrId}`);
      if (!qrOutcome) throw new Error("no QR outcome given");
      return qrOutcome;
    },
    showWebOnly: (url, reason) => log.push(`notice:${reason}:${url}`),
    openBrowser: async (url) => log.push(`browser:${url}`),
  };
  return { effects, log };
}

test("a screen link closes the modal, then opens the screen", async () => {
  const { effects, log } = loggingEffects();
  const opening: LinkOpening = {
    opener: "screen",
    tabRoot: "/(tabs)/bookings",
    href: "/(tabs)/bookings/bk_1",
  };
  await dispatchLinkOpening(opening, effects);
  assert.deepEqual(log, ["leave", "screen:/(tabs)/bookings/bk_1"]);
});

test("a QR link closes the modal only once its screen is known", async () => {
  const opening: LinkOpening = { opener: "qr", qrId: "qr_1", origin: CLOUD };

  const toScreen = loggingEffects({
    kind: "screen",
    tabRoot: "/(tabs)/assets",
    href: "/(tabs)/assets/as_1",
  });
  await dispatchLinkOpening(opening, toScreen.effects);
  assert.deepEqual(toScreen.log, [
    "qr:qr_1",
    "leave",
    "screen:/(tabs)/assets/as_1",
  ]);

  const unresolved = loggingEffects({
    kind: "web-only",
    url: `${CLOUD}/qr/qr_1`,
  });
  await dispatchLinkOpening(opening, unresolved.effects);
  assert.deepEqual(unresolved.log, [
    "qr:qr_1",
    `notice:qr-unresolved:${CLOUD}/qr/qr_1`,
  ]);

  const elsewhere = loggingEffects({
    kind: "browser",
    url: "https://assets.example.org/qr/qr_1",
  });
  await dispatchLinkOpening(opening, elsewhere.effects);
  assert.deepEqual(elsewhere.log, [
    "qr:qr_1",
    "browser:https://assets.example.org/qr/qr_1",
  ]);
});

test("a web-only page shows the notice and keeps the modal open", async () => {
  const { effects, log } = loggingEffects();
  await dispatchLinkOpening(
    {
      opener: "web-only",
      url: `${CLOUD}/locations/loc_1`,
      reason: "no-screen",
    },
    effects
  );
  assert.deepEqual(log, [`notice:no-screen:${CLOUD}/locations/loc_1`]);
});

test("a web page opens in the browser and keeps the modal open", async () => {
  const { effects, log } = loggingEffects();
  await dispatchLinkOpening(
    { opener: "browser", url: "https://canon.com/r5.pdf" },
    effects
  );
  assert.deepEqual(log, ["browser:https://canon.com/r5.pdf"]);
});

test("a modal that chooses to stay keeps the link from opening its screen", async () => {
  for (const stay of [false, Promise.resolve(false)]) {
    const { effects, log } = loggingEffects({
      kind: "screen",
      tabRoot: "/(tabs)/assets",
      href: "/(tabs)/assets/as_1",
    });
    const staying: LinkEffects = {
      ...effects,
      leave: () => {
        log.push("leave");
        return stay;
      },
    };
    await dispatchLinkOpening(
      {
        opener: "screen",
        tabRoot: "/(tabs)/audits",
        href: "/(tabs)/audits/au_1",
      },
      staying
    );
    await dispatchLinkOpening(
      { opener: "qr", qrId: "qr_1", origin: CLOUD },
      staying
    );
    assert.deepEqual(log, ["leave", "qr:qr_1", "leave"]);
  }
});
