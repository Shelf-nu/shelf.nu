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
 * The role-aware reasons both apps show (why an archived asset's actions are
 * off, why a booking holding one cannot be reserved) come from `@shelf/labels`
 * (`archivedAssetBlockedReason`, `archivedAssetsRefusal`). This module holds
 * only the phone's own scan-list wording.
 *
 * This module must stay free of React Native, Expo and `@/` imports: its test
 * runs under Node's test runner.
 *
 * @see ./archived-assets.test.ts
 * @see {@link file://./batch-blockers.ts} the scanner's "asset-archived" blocker
 */

import {
  archivedAssetsLeftOut,
  kitWithoutActiveAssetsReason,
} from "@shelf/labels";
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

/**
 * Why a kit's Assign Custody is off, or `undefined` while it can be assigned.
 *
 * Kit custody leaves archived members out, so a kit with no active member
 * (only archived ones, or none at all) has nothing to hand over and the server
 * refuses it. The web kit page turns the action off with the same words.
 *
 * @param members - Every member of the kit, archived ones included
 * @returns The reason from `@shelf/labels`, or `undefined`
 */
export function kitAssignCustodyBlockedReason(
  members: readonly MaybeArchived[]
): string | undefined {
  if (members.some((member) => !isArchivedAsset(member))) return undefined;
  return kitWithoutActiveAssetsReason({
    hasArchivedAssets: members.length > 0,
    action: "custody",
  });
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
 * The server refused the whole request only on their account, so every other
 * row loses any error an earlier submit left on it: none of them was at fault
 * this time, and an old reason beside the archived one would contradict it.
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
      : row.submitError
      ? { ...row, submitError: undefined }
      : row
  );
}

/**
 * The sentence a success message adds when the server left archived assets
 * out: the archived members of a kit added to a booking, or the archived
 * assets a duplicated booking did not copy.
 *
 * @param count - The server's count; absent from servers that predate it,
 *   and then read as none
 * @returns The sentence, or `null` when nothing was left out
 */
export function archivedLeftOutNote(count: number | undefined): string | null {
  return count && count > 0 ? archivedAssetsLeftOut(count) : null;
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
