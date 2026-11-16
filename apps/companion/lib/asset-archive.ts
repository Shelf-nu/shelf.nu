/**
 * Archiving an asset from the phone: when the action is offered, why it is
 * blocked before the tap, the order of the More menu, and the request flow
 * with the model-reservation "Archive anyway" step.
 *
 * Parity with the web asset page's Archive item
 * (`apps/webapp/app/components/assets/actions-dropdown.tsx`): offered to
 * members holding `asset: update` and `asset: archive` while the asset is
 * active; blocked, with the web's own tooltip words from `@shelf/labels`, when
 * the asset is quantity-tracked, checked out or in custody, or in a kit that is
 * in use. The server (`POST /api/mobile/asset/archive`, `archiveAsset`)
 * enforces every rule; this module only says so before the tap.
 *
 * MIRROR of the conditions around the web's Archive item (the reasons' words
 * are shared, not copied). Cosmetic only: a wrong answer here offers a tap the
 * server refuses, never an archive it would not do. Extraction target: a pure
 * `packages/*` asset module (none yet).
 *
 * Must stay free of React Native, Expo and `@/` imports: its test runs under
 * Node's test runner.
 *
 * @see ./asset-archive.test.ts
 * @see {@link file://./../app/(tabs)/assets/[id].tsx} the asset detail screen
 */

import { archiveAssetBlockedReason } from "@shelf/labels";
import type { ApiErrorDetails } from "./api/error-details";
import { markAssetChanged } from "./asset-refresh";

/**
 * The error `reason` the server sends with the model-reservation warning: the
 * archive was refused and rolled back, and may be resent as confirmed.
 * MIRROR of `MODEL_SHORTFALL_REASON` in
 * `apps/webapp/app/modules/asset/archive-shortfall.ts`; the route test and
 * this module's test pin the same string on each side.
 */
export const MODEL_SHORTFALL_REASON = "model_shortfall";

/**
 * Shown when the server has no archive route. True for Shelf Cloud and
 * self-hosted servers alike.
 */
export const ARCHIVE_UNAVAILABLE_MESSAGE =
  "Archiving isn't available on this server yet.";

/**
 * Whether the asset detail offers "Archive Asset" at all. Mirrors the web,
 * where the item sits in the `asset: update` group and needs `asset: archive`
 * (admins and owners). An archived asset offers Reinstate instead.
 *
 * @param options.canUpdate - holds `asset: update`
 * @param options.canArchive - holds `asset: archive`
 * @param options.isArchived - the asset is archived already
 */
export function canOfferArchive({
  canUpdate,
  canArchive,
  isArchived,
}: {
  canUpdate: boolean;
  canArchive: boolean;
  isArchived: boolean;
}): boolean {
  return canUpdate && canArchive && !isArchived;
}

/** The part of an asset payload the archive check reads. */
type ArchiveCheckAsset = {
  status: string;
  /** Present while someone holds the asset in custody. */
  custody: unknown;
  kit: { status: string } | null;
};

/**
 * Why this asset cannot be archived yet, or `null` when it can. The same
 * words, in the same order, as the web's disabled Archive item.
 *
 * The server refuses every status other than `AVAILABLE`, so every such
 * status is blocked here. The web reads "in use" as checked out or holding a
 * custody row, and a member of a kit in use as the kit's case; an asset marked
 * in custody with neither (no custody row, no kit in use) gets the in-use
 * reason too, rather than a tap the server refuses.
 *
 * @param asset - the asset detail payload
 * @param isQtyTracked - the asset tracks units (`QUANTITY_TRACKED`)
 */
export function archiveBlockedReason(
  asset: ArchiveCheckAsset,
  isQtyTracked: boolean
): string | null {
  const isInUnavailableKit = Boolean(
    asset.kit && asset.kit.status !== "AVAILABLE"
  );
  return archiveAssetBlockedReason({
    isQuantityTracked: isQtyTracked,
    isInUse:
      asset.status === "CHECKED_OUT" ||
      Boolean(asset.custody) ||
      (asset.status !== "AVAILABLE" && !isInUnavailableKit),
    isInUnavailableKit,
  });
}

/** An entry of the asset detail's More menu. */
export type MoreMenuAction = "archive" | "delete";

/**
 * The More menu's entries, in order. Archive comes first and Delete last, so
 * the permanent action never sits where the reversible one is expected.
 *
 * @param options.offerArchive - from {@link canOfferArchive}
 * @param options.canDelete - holds `asset: delete`
 */
export function moreMenuActions({
  offerArchive,
  canDelete,
}: {
  offerArchive: boolean;
  canDelete: boolean;
}): MoreMenuAction[] {
  const actions: MoreMenuAction[] = [];
  if (offerArchive) actions.push("archive");
  if (canDelete) actions.push("delete");
  return actions;
}

/** What `apiFetch` answers for one archive request. */
export type ArchiveAnswer<T> = {
  data: T | null;
  error: string | null;
  errorDetails?: ApiErrorDetails | null;
  status?: number;
};

/** How an archive attempt ended. */
export type ArchiveOutcome<T> =
  | { kind: "archived"; data: T }
  /** The user declined "Archive anyway"; the server changed nothing. */
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

/**
 * HTTP statuses a server without the archive route answers with. The web's
 * catch-all route (`routes/$.tsx`) has a loader and no action, so a POST to a
 * path it does not know gets 405; a plain 404 covers a server without it.
 */
const MISSING_ROUTE_STATUSES = [404, 405];

/**
 * The message for a refused archive: the server's own words, except for a
 * server without the route, whose 404 or 405 carries no mobile error envelope
 * (a 404 WITH the envelope is the service's "asset not found", shown as is).
 *
 * @param answer - the failed request's answer
 */
export function archiveFailureMessage(answer: ArchiveAnswer<unknown>): string {
  if (
    answer.status !== undefined &&
    MISSING_ROUTE_STATUSES.includes(answer.status) &&
    !answer.errorDetails
  ) {
    return ARCHIVE_UNAVAILABLE_MESSAGE;
  }
  return answer.error ?? "Couldn't archive the asset.";
}

/**
 * Archives an asset, asking before overriding a model-reservation warning.
 *
 * Sends once unconfirmed. If the server answers with the shortfall reason, the
 * archive was refused and rolled back; `confirmShortfall` shows the server's
 * message and resolves `true` to resend as confirmed, `false` to stop with
 * nothing changed. Every other refusal ends the attempt with its message.
 *
 * @param options.send - posts the archive; `true` confirms the shortfall
 * @param options.confirmShortfall - asks the user, with the server's message
 * @returns the outcome; never throws for a refusal
 */
export async function runArchive<T>({
  send,
  confirmShortfall,
}: {
  send: (confirmModelShortfall: boolean) => Promise<ArchiveAnswer<T>>;
  confirmShortfall: (message: string) => Promise<boolean>;
}): Promise<ArchiveOutcome<T>> {
  const first = await send(false);
  if (first.data) return { kind: "archived", data: first.data };

  if (first.errorDetails?.reason !== MODEL_SHORTFALL_REASON) {
    return { kind: "failed", message: archiveFailureMessage(first) };
  }

  const goAhead = await confirmShortfall(first.errorDetails.message);
  if (!goAhead) return { kind: "cancelled" };

  const confirmed = await send(true);
  if (confirmed.data) return { kind: "archived", data: confirmed.data };
  return { kind: "failed", message: archiveFailureMessage(confirmed) };
}

/**
 * After an archive or a reinstate lands: tells every screen holding the asset
 * (the assets list skips refetches for a while, a second stack may show the
 * same detail) that it changed, then reloads this screen's copy.
 *
 * @param assetId - the asset archived or reinstated
 * @param refetch - reloads the asset on the current screen
 */
export async function settleArchiveChange(
  assetId: string,
  refetch: () => Promise<unknown>
): Promise<void> {
  markAssetChanged(assetId);
  await refetch();
}
