/**
 * Tests for audit scan drafts: each draft belongs to the account that made
 * it, and the server-switch teardown still finds every draft.
 *
 * @see {@link file://./audit-scan-persistence.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";

/** The fake device store. */
const store = new Map<string, string>();

// why: AsyncStorage is a native module; a Map behaves like the device store.
mock.module("@react-native-async-storage/async-storage", {
  defaultExport: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
    getAllKeys: async () => [...store.keys()],
    removeMany: async (keys: string[]) => {
      for (const key of keys) store.delete(key);
    },
  },
});

/** Durability events reported to Sentry, by name. */
const reported: string[] = [];

// why: Sentry is native; the fake records event names so a test can see that
// a dropped draft is reported.
mock.module(pathToFileURL(join(__dirname, "sentry.ts")).href, {
  namedExports: {
    reportAuditDurabilityEvent: (event: string) => {
      reported.push(event);
    },
  },
});

let persistence: typeof import("./audit-scan-persistence");
let prefix: string;

const ITEM = {
  assetId: "as_1",
  name: "Camera",
  isExpected: true,
  scannedAt: "2026-11-09T10:00:00.000Z",
};
const ENTRY = {
  auditSessionId: "au_1",
  qrId: "qr_1",
  assetId: "as_1",
  isExpected: true,
};

before(async () => {
  persistence = await import("./audit-scan-persistence");
  ({ AUDIT_SCAN_KEY_PREFIX: prefix } = await import("./server/contract"));
});

beforeEach(() => {
  store.clear();
  reported.length = 0;
});

describe("audit scan drafts", () => {
  it("returns a draft to the account that saved it", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);

    const draft = await persistence.loadAuditScanState("user_a", "au_1");

    assert.equal(draft?.userId, "user_a");
    assert.equal(draft?.auditId, "au_1");
    assert.deepEqual(draft?.pendingQueue, [ENTRY]);
  });

  it("never offers one account's draft to another, and keeps it", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);

    assert.equal(await persistence.loadAuditScanState("user_b", "au_1"), null);
    await persistence.clearAuditScanState("user_b", "au_1");

    assert.notEqual(
      await persistence.loadAuditScanState("user_a", "au_1"),
      null
    );
  });

  it("refuses a record whose embedded owner disagrees with its key", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);
    const [key] = [...store.keys()];
    const tampered = { ...JSON.parse(store.get(key)!), userId: "user_b" };
    store.set(key, JSON.stringify(tampered));

    assert.equal(await persistence.loadAuditScanState("user_a", "au_1"), null);
  });

  it("refuses a record whose embedded audit disagrees with its key", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);
    const [key] = [...store.keys()];
    const tampered = { ...JSON.parse(store.get(key)!), auditId: "au_2" };
    store.set(key, JSON.stringify(tampered));

    assert.equal(await persistence.loadAuditScanState("user_a", "au_1"), null);
  });

  it("ignores drafts saved without an owner", async () => {
    store.set(
      `${prefix}au_1`,
      JSON.stringify({
        version: 1,
        auditId: "au_1",
        savedAt: ITEM.scannedAt,
        scannedItems: [ITEM],
        pendingQueue: [ENTRY],
      })
    );

    assert.equal(await persistence.loadAuditScanState("user_a", "au_1"), null);
  });

  it("clears only the signed-in account's draft", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);
    await persistence.saveAuditScanState("user_b", "au_1", [ITEM], [ENTRY]);

    await persistence.clearAuditScanState("user_a", "au_1");

    assert.equal(await persistence.loadAuditScanState("user_a", "au_1"), null);
    assert.notEqual(
      await persistence.loadAuditScanState("user_b", "au_1"),
      null
    );
  });

  it("keeps every draft under the prefix the server-switch teardown sweeps", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);
    await persistence.saveAuditScanState("user_b", "au_2", [ITEM], [ENTRY]);

    assert.equal(store.size, 2);
    for (const key of store.keys()) assert.ok(key.startsWith(prefix), key);
  });

  it("the debounced saver writes under its account", async () => {
    const saver = persistence.createDebouncedSaver("user_a", "au_1", 10);

    await saver.flush([ITEM], [ENTRY]);

    assert.notEqual(
      await persistence.loadAuditScanState("user_a", "au_1"),
      null
    );
    assert.equal(await persistence.loadAuditScanState("user_b", "au_1"), null);
  });

  it("the debounced saver's timed save writes under its account", async () => {
    const saver = persistence.createDebouncedSaver("user_a", "au_1", 5);

    saver.save([ITEM], [ENTRY]);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.notEqual(
      await persistence.loadAuditScanState("user_a", "au_1"),
      null
    );
    assert.equal(await persistence.loadAuditScanState("user_b", "au_1"), null);
  });

  it("the saver's clear removes only its own account's draft", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);
    await persistence.saveAuditScanState("user_b", "au_1", [ITEM], [ENTRY]);

    await persistence.createDebouncedSaver("user_a", "au_1").clear();

    assert.equal(await persistence.loadAuditScanState("user_a", "au_1"), null);
    assert.notEqual(
      await persistence.loadAuditScanState("user_b", "au_1"),
      null
    );
  });
});

describe("pruneStaleAuditDrafts", () => {
  it("drops an ownerless draft and reports its unsynced scans", async () => {
    store.set(
      `${prefix}au_1`,
      JSON.stringify({ version: 1, auditId: "au_1", pendingQueue: [ENTRY] })
    );
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);

    await persistence.pruneStaleAuditDrafts();

    assert.deepEqual([...store.keys()], [`${prefix}user_a:au_1`]);
    assert.deepEqual(reported, ["unowned_draft_dropped"]);
  });

  it("drops any account's draft older than the maximum age", async () => {
    await persistence.saveAuditScanState("user_a", "au_1", [ITEM], [ENTRY]);
    await persistence.saveAuditScanState("user_b", "au_2", [ITEM], [ENTRY]);
    const savedAt = Date.parse(
      JSON.parse(store.get(`${prefix}user_a:au_1`)!).savedAt
    );

    await persistence.pruneStaleAuditDrafts(
      savedAt + persistence.AUDIT_DRAFT_MAX_AGE_MS - 1
    );
    assert.equal(store.size, 2);

    await persistence.pruneStaleAuditDrafts(
      savedAt + persistence.AUDIT_DRAFT_MAX_AGE_MS + 60_000
    );
    assert.equal(store.size, 0);
  });

  it("leaves keys outside the draft prefix alone", async () => {
    store.set("shelf_theme", "dark");

    await persistence.pruneStaleAuditDrafts();

    assert.equal(store.get("shelf_theme"), "dark");
  });
});
