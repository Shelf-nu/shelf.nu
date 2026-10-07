/**
 * Tests for the scan draft.
 *
 * @see {@link file://./scan-draft.ts}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanListItems } from "~/atoms/qr-scanner";
import {
  QUICK_CHECKIN_QR_PREFIX,
  QUICK_CHECKOUT_QR_PREFIX,
} from "~/atoms/qr-scanner";
import {
  clearScanDraft,
  readScanDraft,
  saveScanDraft,
  scanDraftKey,
} from "./scan-draft";

const KEY = scanDraftKey("fulfil", "booking-1");

function scanned(overrides: Partial<NonNullable<ScanListItems[string]>> = {}) {
  return {
    data: { id: "asset-1", title: "Camera" },
    type: "asset" as const,
    codeType: "qr" as const,
    ...overrides,
  } as ScanListItems[string];
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scanDraftKey", () => {
  it("keeps two scanners on the same target apart", () => {
    expect(scanDraftKey("fulfil", "booking-1")).not.toBe(
      scanDraftKey("assign", "booking-1")
    );
  });
});

describe("saveScanDraft / readScanDraft", () => {
  it("round-trips a scanned code", () => {
    saveScanDraft(KEY, { "qr-1": scanned() });

    expect(readScanDraft(KEY)).toEqual({
      "qr-1": { codeType: "qr", type: "asset" },
    });
  });

  /**
   * The whole point of storing codes rather than rows: a restored entry has no
   * `data`, so `GenericItemRow` fetches it again and a list parked overnight
   * comes back with today's availability rather than yesterday's.
   */
  it("stores no row payload, so a restored row re-resolves", () => {
    saveScanDraft(KEY, { "qr-1": scanned() });

    const restored = readScanDraft(KEY);

    expect(restored?.["qr-1"]).not.toHaveProperty("data");
  });

  /**
   * The regression that first broke this: a restored entry carries a type and
   * no data, so re-saving the list it was restored into must keep it. Testing
   * for `data` instead emptied the draft in the moment between restoring a
   * list and its rows resolving again.
   */
  it("keeps a restored entry that has not re-resolved yet", () => {
    saveScanDraft(KEY, { "qr-1": { codeType: "qr", type: "asset" } });

    expect(readScanDraft(KEY)).toEqual({
      "qr-1": { codeType: "qr", type: "asset" },
    });
  });

  it("drops codes that never resolved", () => {
    saveScanDraft(KEY, {
      "qr-1": scanned(),
      "qr-2": undefined,
      "qr-3": { codeType: "qr" },
    });

    expect(Object.keys(readScanDraft(KEY) ?? {})).toEqual(["qr-1"]);
  });

  /** A code that failed once fails again; restoring it only repeats the error. */
  it("drops codes that errored", () => {
    saveScanDraft(KEY, {
      "qr-1": scanned(),
      "qr-2": { error: "Asset not found" },
    });

    expect(Object.keys(readScanDraft(KEY) ?? {})).toEqual(["qr-1"]);
  });

  /**
   * Quick check-in and check-out mint keys that name a booking row, not a code.
   * They mean nothing once the booking has moved on.
   */
  it("drops the synthetic booking-row keys", () => {
    saveScanDraft(KEY, {
      "qr-1": scanned(),
      [`${QUICK_CHECKIN_QR_PREFIX}ba-1`]: scanned(),
      [`${QUICK_CHECKOUT_QR_PREFIX}ba-2`]: scanned(),
    });

    expect(Object.keys(readScanDraft(KEY) ?? {})).toEqual(["qr-1"]);
  });

  it("returns null when nothing was ever saved", () => {
    expect(readScanDraft(KEY)).toBeNull();
  });

  it("removes the draft instead of storing an empty one", () => {
    saveScanDraft(KEY, { "qr-1": scanned() });
    saveScanDraft(KEY, {});

    expect(readScanDraft(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("replaces rather than merges, so a removed row stays removed", () => {
    saveScanDraft(KEY, { "qr-1": scanned(), "qr-2": scanned() });
    saveScanDraft(KEY, { "qr-1": scanned() });

    expect(Object.keys(readScanDraft(KEY) ?? {})).toEqual(["qr-1"]);
  });
});

describe("expiry", () => {
  it("refuses a draft older than the cutoff and removes it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T08:00:00Z"));
    saveScanDraft(KEY, { "qr-1": scanned() });

    vi.setSystemTime(new Date("2026-01-02T08:00:00Z"));

    expect(readScanDraft(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("still restores one parked over a lunch break", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T08:00:00Z"));
    saveScanDraft(KEY, { "qr-1": scanned() });

    vi.setSystemTime(new Date("2026-01-01T09:30:00Z"));

    expect(readScanDraft(KEY)).not.toBeNull();
  });
});

describe("corrupt storage", () => {
  it("discards a draft it cannot parse", () => {
    localStorage.setItem(KEY, "{not json");

    expect(readScanDraft(KEY)).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("discards a draft of the wrong shape", () => {
    localStorage.setItem(KEY, JSON.stringify({ entries: { "qr-1": {} } }));

    expect(readScanDraft(KEY)).toBeNull();
  });

  /**
   * Private windows and blocked site data make every call throw. Scanning has
   * to carry on regardless, so the draft is a convenience that fails silently.
   */
  it("never throws when storage is unavailable", () => {
    const boom = () => {
      throw new Error("blocked");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(boom);

    expect(() => saveScanDraft(KEY, { "qr-1": scanned() })).not.toThrow();
    expect(() => clearScanDraft(KEY)).not.toThrow();
    expect(readScanDraft(KEY)).toBeNull();

    vi.restoreAllMocks();
  });
});

describe("clearScanDraft", () => {
  it("removes a saved draft", () => {
    saveScanDraft(KEY, { "qr-1": scanned() });
    clearScanDraft(KEY);

    expect(readScanDraft(KEY)).toBeNull();
  });
});
