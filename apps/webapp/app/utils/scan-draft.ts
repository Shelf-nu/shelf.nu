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
 * **No row payload is stored.** A `ScanListItem` carries the asset's entire
 * server payload, which is both far too large for this and stale the moment it
 * is written. A draft keeps each code with how it was scanned, plus what the
 * operator set around the list: the units entered and the "From location"
 * picked on the rows (keyed by asset id), and an optional context (on the bulk
 * scanner, the action the list belongs to). A restored entry comes back in the
 * shape of a code that has just been scanned and is still being looked up: no
 * `data` and no `type`, so `GenericItemRow` resolves it again on mount and a
 * resumed list is as current as a freshly scanned one. The `type` is left out
 * on purpose. Scanner drawers read `data` from any entry that has a `type`,
 * which holds for every entry a scan produces, and a restored entry must not be
 * the one exception.
 *
 * This is a stopgap for one browser on one device. The real fix is a persisted
 * server-side session, tracked in GitHub issue #3160.
 *
 * @see {@link file://./../components/scanner/drawer/generic-item-row.tsx} for
 *   the re-resolution that lets a draft leave the row payload out.
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
  /**
   * What the operator was doing with the list when it was parked (on the bulk
   * scanner, which action). Kept inside the draft, so it is written, expired
   * and removed together with the list it belongs to.
   */
  context?: string;
  /** Units entered per quantity-tracked asset, keyed by asset id. */
  quantities?: Record<string, number>;
  /** "From location" picked per pool, keyed by asset id. */
  sources?: Record<string, string>;
  /**
   * The list was sent in a save that got no answer, so it may already be
   * saved. Kept so the warning comes back with the list after a reload.
   */
  unconfirmedSave?: boolean;
};

/**
 * What the operator set on the rows beyond the codes themselves. Both maps are
 * keyed by asset id, like the atoms they come from, so they apply again as soon
 * as a restored row resolves to its asset. Without them a restored list would
 * look complete while each row fell back to its default (one unit, the
 * pre-selected location), and a confirm could move the wrong units.
 */
export type ScanDraftChoices = {
  quantities: Record<string, number>;
  sources: Record<string, string>;
};

/** Everything a draft keeps besides its codes. See {@link saveScanDraft}. */
export type ScanDraftExtras = {
  /**
   * What the operator is doing with the list, handed back by
   * {@link readScanDraftContext}.
   */
  context?: string | null;
  /** The per-row choices, handed back by {@link readScanDraftChoices}. */
  choices?: ScanDraftChoices;
  /**
   * The list was sent in a save that got no answer. Handed back by
   * {@link readScanDraftUnconfirmedSave}.
   */
  unconfirmedSave?: boolean;
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
 * @param extras - Context and per-row choices, written with every save so a
 *   list that is emptied and refilled still carries them.
 */
export function saveScanDraft(
  key: string,
  items: ScanListItems,
  { context, choices, unconfirmedSave }: ScanDraftExtras = {}
): void {
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

  const draft: StoredDraft = {
    savedAt: Date.now(),
    entries,
    ...(context ? { context } : {}),
    ...(choices && Object.keys(choices.quantities).length > 0
      ? { quantities: choices.quantities }
      : {}),
    ...(choices && Object.keys(choices.sources).length > 0
      ? { sources: choices.sources }
      : {}),
    ...(unconfirmedSave ? { unconfirmedSave: true } : {}),
  };

  try {
    localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Private windows, blocked site data and a full quota all land here. A
    // draft is a convenience, so losing it must never interrupt scanning.
  }
}

/**
 * Reads the stored draft, or `null` when there is none worth using.
 *
 * An expired, unreadable or malformed draft is removed rather than returned,
 * so nothing stored with it (its context included) outlives the expiry.
 *
 * @param key - From {@link scanDraftKey}.
 * @returns The stored draft, or `null`.
 */
function readStoredDraft(key: string): StoredDraft | null {
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

  return draft;
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
  const draft = readStoredDraft(key);
  if (!draft) {
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
 * Reads the context saved with a draft: what the operator was doing with the
 * list when it was parked.
 *
 * It lives inside the draft, so it is `null` whenever the draft is gone,
 * expired or unreadable.
 *
 * @param key - From {@link scanDraftKey}.
 * @returns The saved value, or `null` when none was saved
 */
export function readScanDraftContext(key: string): string | null {
  const context = readStoredDraft(key)?.context;
  return typeof context === "string" && context ? context : null;
}

/**
 * Reads the per-row choices saved with a draft. Values of the wrong shape are
 * left out, so a damaged entry falls back to the row's default.
 *
 * @param key - From {@link scanDraftKey}.
 * @returns The saved choices, empty when the draft has none or is gone
 */
export function readScanDraftChoices(key: string): ScanDraftChoices {
  const draft = readStoredDraft(key);
  const quantities: Record<string, number> = {};
  const sources: Record<string, string> = {};

  if (draft?.quantities && typeof draft.quantities === "object") {
    for (const [assetId, quantity] of Object.entries(draft.quantities)) {
      if (Number.isInteger(quantity) && quantity >= 1) {
        quantities[assetId] = quantity;
      }
    }
  }
  if (draft?.sources && typeof draft.sources === "object") {
    for (const [assetId, source] of Object.entries(draft.sources)) {
      if (typeof source === "string" && source) {
        sources[assetId] = source;
      }
    }
  }

  return { quantities, sources };
}

/**
 * Whether the parked list was sent in a save that got no answer, so it may
 * already be saved and the operator must check before confirming it again.
 *
 * @param key - From {@link scanDraftKey}.
 * @returns `true` only for a draft that carries the mark
 */
export function readScanDraftUnconfirmedSave(key: string): boolean {
  return readStoredDraft(key)?.unconfirmedSave === true;
}

/**
 * Removes a draft, and the context saved with it. Called once its scans have
 * been saved, so returning to the scanner does not offer work that is already
 * done.
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
