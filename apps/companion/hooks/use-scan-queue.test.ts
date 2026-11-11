/**
 * Tests for `useScanQueue`'s per-account rules, rendered in a plain React
 * test tree: a scan is queued only for the queue's owner, `enqueueScan` says
 * whether it was, and a drain started for the owner keeps sending after the
 * screen unmounts.
 *
 * @see {@link file://./use-scan-queue.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, beforeEach, describe, it, mock } from "node:test";
import { act, createElement } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import type { ScanQueueResult } from "./use-scan-queue";

/** Requests the fake server received, by asset id, and their answers. */
const server = {
  sent: [] as string[],
  pending: [] as Array<() => void>,
  /** When true, each request waits until the test releases it. */
  hold: false,
  /** How many of the next requests fail with a network error. */
  failNext: 0,
};
/** The app's account counter, moved by hand. */
let accountGeneration = 0;

const lib = (path: string) =>
  pathToFileURL(join(__dirname, "..", "lib", path)).href;

// why: the API layer reaches the network through Supabase. The fake answers
// every scan, optionally holding it so a test can unmount mid-drain.
mock.module(lib("api.ts"), {
  namedExports: {
    api: {
      recordAuditScan: (_orgId: string, entry: { assetId: string }) =>
        new Promise((resolve) => {
          const answer = () => {
            server.sent.push(entry.assetId);
            resolve({ data: { auditAssetId: `row-${entry.assetId}` } });
          };
          if (server.failNext > 0) {
            server.failNext -= 1;
            resolve({ error: "Network request failed" });
            return;
          }
          if (server.hold) server.pending.push(answer);
          else answer();
        }),
    },
    accountGeneration: { current: () => accountGeneration },
  },
});

// why: drafts are written to AsyncStorage (native); the hook's draft rules are
// tested in audit-scan-persistence.test.ts.
const draftWrites: string[] = [];
mock.module(lib("audit-scan-persistence.ts"), {
  namedExports: {
    saveAuditScanState: async (
      _owner: string,
      _auditId: string,
      _items: unknown[],
      queue: { assetId: string }[]
    ) => {
      draftWrites.push(queue.map((e) => e.assetId).join(","));
      return true;
    },
  },
});

// why: Sentry is native; durability reports are not under test here.
mock.module(lib("sentry.ts"), {
  namedExports: { reportAuditDurabilityEvent: () => {} },
});

let useScanQueue: typeof import("./use-scan-queue").useScanQueue;

before(async () => {
  ({ useScanQueue } = await import("./use-scan-queue"));
});

beforeEach(() => {
  server.sent.length = 0;
  server.pending.length = 0;
  server.hold = false;
  server.failNext = 0;
  draftWrites.length = 0;
  accountGeneration = 0;
});

/** Renders the hook for a signed-in user and exposes its latest result. */
function renderQueue(userId: string | undefined, auditId = "au_1") {
  const latest: { current: ScanQueueResult | null } = { current: null };
  const scannedItemsRef = { current: [] };
  function Probe(props: { userId: string | undefined }) {
    latest.current = useScanQueue({
      orgId: "org_1",
      auditId,
      userId: props.userId,
      scannedItemsRef,
    });
    return null;
  }
  let renderer: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(Probe, { userId }));
  });
  return {
    latest,
    rerender: (next: string | undefined) =>
      act(() => {
        renderer.update(createElement(Probe, { userId: next }));
      }),
    unmount: () =>
      act(() => {
        renderer.unmount();
      }),
  };
}

const entry = (assetId: string) => ({
  auditSessionId: "au_1",
  qrId: `qr-${assetId}`,
  assetId,
  isExpected: true,
});

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useScanQueue", () => {
  it("queues the owner's scan and says so", async () => {
    const queue = renderQueue("user_a");

    assert.equal(queue.latest.current!.enqueueScan(entry("a-1")), true);
    await flush();

    assert.deepEqual(server.sent, ["a-1"]);
  });

  it("refuses a scan once another account is signed in, and says so", async () => {
    const queue = renderQueue("user_a");
    queue.rerender("user_b");

    assert.equal(queue.latest.current!.enqueueScan(entry("a-1")), false);
    await flush();

    assert.deepEqual(server.sent, []);
    assert.equal(queue.latest.current!.scanQueueRef.current.length, 0);
  });

  it("refuses a scan while nobody is signed in", () => {
    const queue = renderQueue("user_a");
    queue.rerender(undefined);

    assert.equal(queue.latest.current!.enqueueScan(entry("a-1")), false);
  });

  it("keeps sending the owner's queue after the screen unmounts", async () => {
    const queue = renderQueue("user_a");
    server.hold = true;
    queue.latest.current!.enqueueScan(entry("a-1"));
    queue.latest.current!.enqueueScan(entry("a-2"));
    queue.latest.current!.enqueueScan(entry("a-3"));

    queue.unmount();
    server.hold = false;
    while (server.pending.length > 0) {
      server.pending.shift()!();
      await flush();
    }

    assert.deepEqual(server.sent, ["a-1", "a-2", "a-3"]);
  });

  it("stops sending after the screen unmounts once the account changes", async () => {
    const queue = renderQueue("user_a");
    server.hold = true;
    queue.latest.current!.enqueueScan(entry("a-1"));
    queue.latest.current!.enqueueScan(entry("a-2"));

    queue.unmount();
    accountGeneration += 1; // a sign-out after the screen closed
    server.hold = false;
    server.pending.shift()!(); // the request already in flight completes
    await flush();

    assert.deepEqual(server.sent, ["a-1"]);
  });

  it("resumes sending when the owner signs back in", async () => {
    const queue = renderQueue("user_a");
    server.hold = true;
    queue.latest.current!.enqueueScan(entry("a-1"));
    queue.latest.current!.enqueueScan(entry("a-2"));

    accountGeneration += 1; // the owner's session ends
    queue.rerender(undefined);
    server.hold = false;
    server.pending.shift()!(); // the request in flight completes
    await flush();
    assert.deepEqual(server.sent, ["a-1"]); // the drain stopped

    accountGeneration += 1; // the owner signs back in
    queue.rerender("user_a");
    await flush();

    assert.deepEqual(server.sent, ["a-1", "a-2"]);
  });

  it("resumes sending when the owner is back after a retry backoff fired", async () => {
    const queue = renderQueue("user_a");
    server.failNext = 1;
    queue.latest.current!.enqueueScan(entry("a-1"));
    await flush();
    assert.deepEqual(server.sent, []); // failed: a 2s backoff is scheduled

    queue.rerender(undefined); // the owner's session pauses
    // The backoff fires while nobody is signed in, so it sends nothing.
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    await flush();
    assert.deepEqual(server.sent, []);

    queue.rerender("user_a");
    await flush();

    assert.deepEqual(server.sent, ["a-1"]);
    queue.unmount();
  });

  it("a closed screen's drain stops writing the draft once a newer screen opens", async () => {
    const first = renderQueue("user_a");
    server.hold = true;
    first.latest.current!.enqueueScan(entry("a-1"));
    first.unmount(); // the auditor leaves while a-1 is in flight

    const second = renderQueue("user_a"); // and reopens the audit
    draftWrites.length = 0;
    server.hold = false;
    server.pending.shift()!(); // the old drain's request completes
    await flush();

    assert.deepEqual(server.sent, ["a-1"]);
    assert.deepEqual(draftWrites, []); // the new screen's draft is untouched
    second.unmount();
  });

  it("a closed screen's drain keeps its draft when another audit's screen opens", async () => {
    const first = renderQueue("user_a", "au_1");
    server.hold = true;
    first.latest.current!.enqueueScan(entry("a-1"));
    first.unmount(); // the auditor leaves au_1 while a-1 is in flight

    const second = renderQueue("user_a", "au_2"); // and opens another audit
    draftWrites.length = 0;
    server.hold = false;
    server.pending.shift()!();
    await flush();

    assert.deepEqual(server.sent, ["a-1"]);
    // au_1's draft is still updated: no newer screen loaded it.
    assert.deepEqual(draftWrites, [""]);
    second.unmount();
  });
});
