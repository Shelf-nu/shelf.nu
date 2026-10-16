/**
 * Tests for the scan history sheet's page state: the first page replaces,
 * later pages append, a failure keeps what is shown, and closing starts over.
 *
 * @see {@link file://./scan-history-state.ts}
 */
import { describe, expect, it } from "vitest";
import type { ScanHistoryRow } from "~/modules/scan/history.server";
import {
  INITIAL_SCAN_HISTORY_STATE,
  scanHistoryReducer,
} from "./scan-history-state";

/** A row with the given id; the other fields do not matter here. */
function row(id: string): ScanHistoryRow {
  return {
    id,
    scannedAt: "2026-10-16T10:00:00.000Z",
    scannedBy: "Unknown",
    code: "QR code",
    source: "QR link",
    coordinates: null,
    device: "Unknown device",
  };
}

describe("scanHistoryReducer", () => {
  it("loads the first page into an empty sheet", () => {
    const requested = scanHistoryReducer(INITIAL_SCAN_HISTORY_STATE, {
      type: "request",
      cursor: null,
    });
    expect(requested.phase).toBe("loading");

    const loaded = scanHistoryReducer(requested, {
      type: "receive",
      page: { scans: [row("a"), row("b")], nextCursor: "b" },
    });
    expect(loaded.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(loaded.nextCursor).toBe("b");
    expect(loaded.phase).toBe("loaded");
  });

  it("appends a later page after the rows already shown", () => {
    const first = scanHistoryReducer(
      scanHistoryReducer(INITIAL_SCAN_HISTORY_STATE, {
        type: "request",
        cursor: null,
      }),
      { type: "receive", page: { scans: [row("a")], nextCursor: "a" } }
    );

    const second = scanHistoryReducer(
      scanHistoryReducer(first, { type: "request", cursor: "a" }),
      { type: "receive", page: { scans: [row("b")], nextCursor: null } }
    );

    expect(second.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(second.nextCursor).toBeNull();
  });

  it("keeps the rows shown when a page fails, and remembers the cursor to retry", () => {
    const first = scanHistoryReducer(
      scanHistoryReducer(INITIAL_SCAN_HISTORY_STATE, {
        type: "request",
        cursor: null,
      }),
      { type: "receive", page: { scans: [row("a")], nextCursor: "a" } }
    );

    const failed = scanHistoryReducer(
      scanHistoryReducer(first, { type: "request", cursor: "a" }),
      { type: "fail", message: "Boom" }
    );

    expect(failed.rows.map((r) => r.id)).toEqual(["a"]);
    expect(failed.phase).toBe("failed");
    expect(failed.errorMessage).toBe("Boom");
    expect(failed.pendingCursor).toBe("a");
  });

  it("starts over when the sheet closes", () => {
    const loaded = scanHistoryReducer(
      scanHistoryReducer(INITIAL_SCAN_HISTORY_STATE, {
        type: "request",
        cursor: null,
      }),
      { type: "receive", page: { scans: [row("a")], nextCursor: "a" } }
    );

    expect(scanHistoryReducer(loaded, { type: "reset" })).toEqual(
      INITIAL_SCAN_HISTORY_STATE
    );
  });
});
