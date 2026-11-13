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
 * is written. A restored entry comes back in the shape of a code that has just
 * been scanned and is still being looked up: no `data` and no `type`, so
 * `GenericItemRow` resolves it again on mount and a resumed list is as current
 * as a freshly scanned one. The `type` is left out on purpose. Scanner drawers
 * read `data` from any entry that has a `type`, which holds for every entry a
 * scan produces, and a restored entry must not be the one exception.
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
 * Kept: every code that resolved, and every code still owed a lookup
 * (`pendingLookup`: restored from a draft, or its last lookup got no answer).
 * Nothing is known to be wrong with those, and they are looked up again when
 * the draft is restored. Dropped: a code the server refused, which would only
 * be refused again, and a code scanned a moment ago that has not resolved
 * either way yet. Writing an empty list removes the draft rather than storing
 * an empty one.
 *
 * @param key - From {@link scanDraftKey}.
 * @param items - The current scan list.
 */
export function saveScanDraft(key: string, items: ScanListItems): void {
  const entries: Record<string, DraftEntry> = {};

  for (const [code, item] of Object.entries(items)) {
    if (!item) {
      continue;
    }
    // A code still owed a lookup is kept whatever else it carries: a restored
    // entry has no type until its fetch lands, and dropping it then would
    // empty the draft in the moments after a restore. Otherwise only a
    // resolved code is worth keeping.
    if (!item.pendingLookup && (item.error || !item.type)) {
      continue;
    }
    if (isSyntheticKey(code)) {
      continue;
    }
    entries[code] = { codeType: item.codeType };
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
    restored[code] = { codeType: entry?.codeType, pendingLookup: true };
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

/** Where a draft's context is kept: beside the draft, under its own key. */
function contextKey(key: string): string {
  return `${key}:context`;
}

/**
 * Remembers one piece of context for a draft: what the operator was doing
 * with the list when it was parked (on the bulk scanner, which action).
 *
 * It is kept on its own, not removed with the draft. A draft is emptied and
 * refilled many times while one list is being scanned (it holds nothing
 * until the first code resolves), and losing the context each time would
 * leave a list with no way back to where it belongs. On its own it means
 * nothing: {@link readScanDraftContext} is only worth calling for a draft
 * that {@link readScanDraft} has just returned, which is what enforces the
 * expiry.
 *
 * @param key - From {@link scanDraftKey}.
 * @param context - The value to put back with the list.
 */
export function saveScanDraftContext(key: string, context: string): void {
  try {
    localStorage.setItem(contextKey(key), context);
  } catch {
    // See `saveScanDraft`.
  }
}

/**
 * Reads the context saved with a draft.
 *
 * @param key - From {@link scanDraftKey}.
 * @returns The saved value, or `null` when none was saved
 */
export function readScanDraftContext(key: string): string | null {
  try {
    return localStorage.getItem(contextKey(key));
  } catch {
    return null;
  }
}
