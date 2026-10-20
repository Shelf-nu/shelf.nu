/**
 * Whether the asset screen's "Assign Custody" is blocked because the asset is
 * an individually tracked kit member, and the reason the screen shows.
 *
 * MIRROR of `isIndividualKitMember` in
 * `apps/webapp/app/modules/asset/utils.ts`, which drives the web asset page's
 * disabled "Assign custody". Cosmetic only: the server refuses the request
 * itself with `assertNotKitMembers`
 * (`apps/webapp/app/modules/custody/service.server.ts`), which
 * `POST /api/mobile/custody/assign` reaches through `bulkCheckOutAssets`, so a
 * build without this check still gets the refusal, just after the tap. The
 * reason text comes from `@shelf/labels`, so the phone and the website cannot
 * word it differently. Extraction target: a pure `packages/*` asset module
 * (none yet).
 *
 * Quantity-tracked assets are never blocked: a kit holds only a slice of a
 * pool, and the units outside every kit can still be handed over on their own.
 *
 * This module must stay free of React Native, Expo and `@/` imports: its test
 * runs under Node's test runner.
 *
 * @see ./kit-member-custody.test.ts
 */
import {
  KIT_MEMBER_CUSTODY_BLOCKED_TITLE,
  kitMemberCustodyBlockedReason,
} from "@shelf/labels";
import type { AssetDetail } from "./api/types";

/** Why "Assign Custody" is blocked, ready for an alert and a hint line. */
export type KitMemberCustodyBlock = {
  title: string;
  reason: string;
};

/**
 * Returns the block for an individually tracked kit member, or `null` when
 * the asset can be put into custody on its own.
 *
 * A missing `type` (a server older than quantity tracking) reads as
 * individually tracked, as it does everywhere else in the app.
 *
 * @param asset - The asset's type and kit, as the asset detail route sends them
 * @returns The title and reason to show, or `null` when nothing blocks it
 */
export function kitMemberCustodyBlock(
  asset: Pick<AssetDetail, "type" | "kit">
): KitMemberCustodyBlock | null {
  if (!asset.kit || asset.type === "QUANTITY_TRACKED") return null;

  return {
    title: KIT_MEMBER_CUSTODY_BLOCKED_TITLE,
    reason: kitMemberCustodyBlockedReason(asset.kit.name),
  };
}
