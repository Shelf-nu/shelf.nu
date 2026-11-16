/**
 * A scanning session's list of codes, kept outside React so it survives a
 * refresh, a closed tab or a phone going to sleep mid-aisle.
 *
 * `scannedItemsAtom` lives in React memory and every scanner clears it on entry
 * and on exit, which is what stops one flow's scans leaking into the next. That
 * lifecycle is deliberate and this module does not change it: the draft sits
 * beside the atom, scoped to one flow and one target, and a flow opts in by
 * restoring from it on entry and writing to it as the list changes.
 *
 * **Only the codes are stored.** A `ScanListItem` carries the asset's entire
 * server payload, which is both far too large for this and stale the moment it
 * is written. A restored entry has no `data`, so `GenericItemRow` resolves it
 * again on mount and a resumed list is as current as a freshly scanned one.
 *
 * This is a stopgap for one browser on one device. The real fix is a persisted
 * server-side session, tracked in GitHub issue #3160.
 *
 * @see {@link file://./../components/scanner/drawer/generic-item-row.tsx} for
 *   the re-resolution that makes storing codes alone sufficient.
 */
import type { ScanListItems } from "~/atoms/qr-scanner";
import {
  QUICK_CHECKIN_QR_PREFIX,
  QUICK_CHECKOUT_QR_PREFIX,
} from "~/atoms/qr-scanner";

/** Namespace for every draft key, so one `localStorage` sweep finds them all. */
const DRAFT_KEY_PREFIX = "shelf:scan-draft:";

/**
 * How long a parked draft is worth restoring.
 *
 * Long enough to survive a dropped phone, a reboot or a lunch break, short
 * enough that a list abandoned last week does not reappear under someone who
 * has forgotten it existed. Enforced on read, so an expired draft is never
 * shown even if nothing has swept it yet.
 */
const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

/** One scanned code, reduced to what is worth keeping. */
type DraftEntry = {
  codeType?: "qr" | "barcode" | "samId";
  type?: "asset" | "kit";
};

type StoredDraft = {
  savedAt: number;
  entries: Record<string, DraftEntry>;
};

/**
 * Builds the storage key for one flow's draft on one target, for one person.
 *
 * The user is part of the key because this storage belongs to the browser, not
 * to the account: a warehouse terminal or a shared tablet carries one store
 * across everyone who signs in on it. Without the user in the key, the next
 * person to open the same booking inherits the previous one's parked list and
 * can submit it under their own name.
 *
 * @param scope - The flow, e.g. `"fulfil"`. Distinct per scanner so two
 *   scanners open on the same booking never read each other's list.
 * @param userId - The signed-in user the draft belongs to.
 * @param targetId - What is being scanned into: a booking, a kit, a location.
 * @returns The namespaced `localStorage` key.
 */
export function scanDraftKey(
  scope: string,
  userId: string,
  targetId: string
): string {
  return `${DRAFT_KEY_PREFIX}${scope}:${userId}:${targetId}`;
}

/**
 * Synthetic scan-list keys that stand for a booking row rather than a code.
 *
 * They are minted by the quick check-in and check-out paths and mean nothing
 * once the booking has moved on, so they are never stored or restored.
 */
function isSyntheticKey(key: string): boolean {
  return (
    key.startsWith(QUICK_CHECKIN_QR_PREFIX) ||
    key.startsWith(QUICK_CHECKOUT_QR_PREFIX)
  );
}

/**
 * Saves the resolved codes from a scan list, replacing any previous draft.
 *
 * Unresolved and failed entries are dropped: a code that did not resolve has
 * nothing to restore, and one that errored would only fail again. Writing an
 * empty list removes the draft rather than storing an empty one.
 *
 * @param key - From {@link scanDraftKey}.
 * @param items - The current scan list.
 */
export function saveScanDraft(key: string, items: ScanListItems): void {
  const entries: Record<string, DraftEntry> = {};

  for (const [code, item] of Object.entries(items)) {
    // `type` is the test, not `data`. A restored entry has a type and no data
    // precisely so its row re-resolves, and it keeps that shape until the
    // fetch lands; requiring `data` would drop the whole list back out of the
    // draft in the moments after a restore.
    if (!item || item.error || !item.type) {
      continue;
    }
    if (isSyntheticKey(code)) {
      continue;
    }
    entries[code] = { codeType: item.codeType, type: item.type };
  }

  if (Object.keys(entries).length === 0) {
    clearScanDraft(key);
    return;
  }

  const draft: StoredDraft = { savedAt: Date.now(), entries };

  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Private windows, blocked site data and a full quota all land here. A
    // draft is a convenience, so losing it must never interrupt scanning.
  }
}

/**
 * Reads a draft back as scan-list entries, or `null` when there is nothing
 * worth restoring.
 *
 * Entries carry no `data`, so each row re-resolves against the server on mount.
 * An expired or unreadable draft is removed rather than returned.
 *
 * @param key - From {@link scanDraftKey}.
 * @returns Scan-list entries ready to seed the atom, or `null`.
 */
export function readScanDraft(key: string): ScanListItems | null {
  let raw: string | null = null;

  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let draft: StoredDraft;
  try {
    draft = JSON.parse(raw) as StoredDraft;
  } catch {
    clearScanDraft(key);
    return null;
  }

  if (
    !draft ||
    typeof draft.savedAt !== "number" ||
    !draft.entries ||
    typeof draft.entries !== "object"
  ) {
    clearScanDraft(key);
    return null;
  }

  if (Date.now() - draft.savedAt > DRAFT_TTL_MS) {
    clearScanDraft(key);
    return null;
  }

  const restored: ScanListItems = {};
  for (const [code, entry] of Object.entries(draft.entries)) {
    if (isSyntheticKey(code)) {
      continue;
    }
    restored[code] = { codeType: entry?.codeType, type: entry?.type };
  }

  return Object.keys(restored).length > 0 ? restored : null;
}

/**
 * Removes a draft. Called once its scans have been submitted, so returning to
 * the scanner does not offer work that is already done.
 *
 * @param key - From {@link scanDraftKey}.
 */
export function clearScanDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // See `saveScanDraft`.
  }
}
