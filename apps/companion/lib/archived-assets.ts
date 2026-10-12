/**
 * Archived assets on the phone: how to recognise one, which badge it shows,
 * and the words for why it cannot be changed.
 *
 * An archived asset (`Asset.archivedAt` set) is out of service and read-only.
 * The server refuses every change to it except reinstate and permanent delete
 * (`assertAssetsAreNotArchived` in
 * `apps/webapp/app/utils/org-validation.server.ts`), and refuses to put it in
 * a booking. The phone shows that state before the tap, so nobody fills in a
 * form or a scan list that can only fail. Cosmetic only: the server enforces
 * every rule on the write.
 *
 * One calm "Archived" badge replaces the live status wherever an archived
 * asset is drawn, matching the web's `ArchivedBadge`: its underlying status
 * ("Available") is true but misleading, because the asset cannot be used.
 *
 * The reasons are role-aware. Members who hold `asset: archive` (admins and
 * owners) can reinstate the asset themselves; everyone else is told to ask an
 * admin, because "reinstate it" names an action they do not have.
 *
 * MIRROR of the web's archived wording, cosmetic only: the reason in
 * `apps/webapp/app/components/assets/actions-dropdown.tsx` ("This asset is
 * archived. Reinstate it to make changes."), made role-aware here, and the
 * web's "remove from booking" refusal. The server enforces every rule on the
 * write. Extraction target: `@shelf/labels` (`archivedAssetBlockedReason`,
 * `archivedAssetsRefusal`), so both apps read one string.
 *
 * This module must stay free of React Native, Expo and `@/` imports: its test
 * runs under Node's test runner.
 *
 * @see ./archived-assets.test.ts
 * @see {@link file://./batch-blockers.ts} the scanner's "asset-archived" blocker
 */

import type { BatchScanAction } from "./batch-blockers";

/** The badge key an archived asset shows instead of its status. */
export const ARCHIVED_BADGE_STATUS = "ARCHIVED";

/** The error `reason` the mobile API sends when it refuses archived assets. */
const ARCHIVED_ERROR_REASON = "archived";

/** The part of an asset payload this module reads. */
type MaybeArchived = {
  /**
   * ISO timestamp when the asset was archived, `null` while it is active.
   * Absent from servers that predate archiving, which have no archived assets.
   */
  archivedAt?: string | null;
};

/**
 * Whether an asset is archived.
 *
 * @param asset - Any asset payload carrying `archivedAt`
 * @returns `true` when `archivedAt` is set
 */
export function isArchivedAsset(
  asset: MaybeArchived | null | undefined
): boolean {
  return Boolean(asset?.archivedAt);
}

/**
 * The status key to draw an asset's badge with. Archived wins over the live
 * status, so an archived asset never reads as "Available".
 *
 * @param asset - The asset's status and archive stamp
 * @returns `"ARCHIVED"` for an archived asset, otherwise its own status
 */
export function assetBadgeStatus(
  asset: MaybeArchived & { status: string }
): string {
  return isArchivedAsset(asset) ? ARCHIVED_BADGE_STATUS : asset.status;
}

/** Who is reading the reason: can they reinstate the asset themselves? */
type ArchivedAudience = {
  /** True for members holding `asset: archive` (admins and owners). */
  canReinstate: boolean;
};

/**
 * Why an archived asset's actions are off, for its own screen.
 *
 * @param audience - Whether the reader can reinstate it
 * @returns One sentence for the notice and the disabled actions' hint
 */
export function archivedAssetReason({ canReinstate }: ArchivedAudience) {
  return canReinstate
    ? "This asset is archived. Reinstate it to make changes."
    : "This asset is archived. Ask an admin to reinstate it.";
}

/** How many archived assets a reason names before summarising the rest. */
const NAMED_IN_REASON = 3;

/**
 * Names for a sentence: `"A"`, `"A" and "B"`, `"A", "B", "C" and 2 more`.
 *
 * @param titles - At least one asset title
 * @returns The quoted list
 */
function quotedTitles(titles: string[]): string {
  const named = titles.slice(0, NAMED_IN_REASON).map((title) => `"${title}"`);
  const rest = titles.length - named.length;
  if (rest > 0) return `${named.join(", ")} and ${rest} more`;
  if (named.length === 1) return named[0];
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * Why a draft booking that holds archived assets cannot be reserved. Names
 * the assets, so they can be found in a long list.
 *
 * Removing them is always offered: anyone who can edit the booking can do
 * that, while reinstating is for admins only. Same words as the web's
 * "remove from booking" refusal (`archivedAssetsRefusal` with
 * `fix: "remove-from-booking"` in `@shelf/labels`).
 *
 * @param titles - Titles of the archived assets the booking holds
 * @param audience - Whether the reader can reinstate them
 * @returns The reason shown above the disabled Reserve button
 */
export function archivedAssetsInBookingReason(
  titles: string[],
  { canReinstate }: ArchivedAudience
) {
  const them = titles.length === 1 ? "it" : "them";
  const subject = `${quotedTitles(titles)} ${
    titles.length === 1 ? "is" : "are"
  } archived.`;
  return canReinstate
    ? `${subject} Remove ${them} from the booking or reinstate ${them}.`
    : `${subject} Remove ${them} from the booking or ask an admin to reinstate ${them}.`;
}

/**
 * The error a scan-list row carries when the server refused it as archived.
 * The other rows of that submit wait unmarked: they are not at fault.
 */
export const ARCHIVED_ROW_ERROR = "Archived. Remove it from the list.";

/**
 * The scan card's line when an archived asset joins a scan list. The row
 * stays in the list, flagged by the "asset-archived" blocker, until it is
 * removed.
 *
 * @param action - What the list is for
 * @returns One short sentence for the scan card
 */
export function archivedScanNote(action: BatchScanAction): string {
  switch (action) {
    case "assign_custody":
      return "Archived, so it can't be put in custody.";
    case "release_custody":
      return "Archived, so it has no custody to release.";
    case "update_location":
      return "Archived, so it can't be moved.";
    case "booking_add":
    case "booking_fulfil":
      return "Archived, so it can't be booked.";
  }
}

/** The part of a scan-list row {@link markArchivedRows} reads and writes. */
type MarkableRow = {
  type: "asset" | "kit";
  /** Asset id for an asset row, kit id for a kit row. */
  targetId: string;
  archived?: boolean;
  submitError?: string;
};

/**
 * Marks the asset rows a refusal named as archived: they read "Archived",
 * raise the "asset-archived" blocker and carry {@link ARCHIVED_ROW_ERROR}.
 * Every other row is returned as it was, because the server refused the whole
 * request only on their account.
 *
 * @param rows - The scan list
 * @param archivedAssetIds - From {@link archivedIdsFromError}
 * @returns The list with those rows marked; the same array when none are named
 */
export function markArchivedRows<T extends MarkableRow>(
  rows: T[],
  archivedAssetIds: readonly string[]
): T[] {
  if (archivedAssetIds.length === 0) return rows;
  const archived = new Set(archivedAssetIds);
  return rows.map((row) =>
    row.type === "asset" && archived.has(row.targetId)
      ? { ...row, archived: true, submitError: ARCHIVED_ROW_ERROR }
      : row
  );
}

/**
 * The sentence shown after a duplicate when the server left archived assets
 * out of the copy.
 *
 * @param count - `droppedArchivedCount` from the duplicate response
 * @returns The note, or `null` when nothing was left out
 */
export function droppedArchivedNote(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count === 1
    ? "1 archived asset was left out of the copy. Archived assets can't be booked."
    : `${count} archived assets were left out of the copy. Archived assets can't be booked.`;
}

/**
 * The asset ids an API error names as archived.
 *
 * The mobile API refuses a write that touches archived assets with
 * `{ error: { message, reason: "archived", archivedAssetIds } }`. Any other
 * refusal, or a server that predates the field, names none.
 *
 * @param details - The `errorDetails` from `apiFetch`
 * @returns The archived asset ids, empty when the error is about something else
 */
export function archivedIdsFromError(
  details:
    | { reason?: string; archivedAssetIds?: readonly string[] }
    | null
    | undefined
): string[] {
  if (details?.reason !== ARCHIVED_ERROR_REASON) return [];
  return [...(details.archivedAssetIds ?? [])];
}
