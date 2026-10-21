/**
 * SSO purchase gate.
 *
 * Institutions that sign their members in through SSO need a guarantee that
 * those members cannot buy a subscription. A user flagged `sso` may start a
 * purchase only when they own a TEAM workspace (the workspace owner is
 * `Organization.userId`), and never for the `tier_1` plan. Everyone else is
 * unaffected.
 *
 * `ssoUserMayPurchase` is the pure rule; `assertUserMayPurchase` loads the facts
 * and throws a 403 for routes to call before any checkout or trial starts.
 *
 * @see {@link file://./../../routes/_layout+/account-details.subscription.tsx}
 * @see {@link file://./../../routes/_welcome+/welcome.tsx}
 */

import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import { PURCHASES_UNAVAILABLE_MESSAGE } from "./purchase-copy";

/** Plans a purchase can target. */
type PurchaseTier = "tier_1" | "tier_2";

/**
 * Decides whether a user may start a purchase.
 *
 * @param args.sso - Whether the user signs in through SSO
 * @param args.ownsTeamWorkspace - Whether the user owns at least one TEAM workspace
 * @param args.shelfTier - The plan being purchased, when known
 * @returns `true` for non-SSO users. For SSO users, `false` for `tier_1`,
 * otherwise whether they own a TEAM workspace.
 */
export function ssoUserMayPurchase({
  sso,
  ownsTeamWorkspace,
  shelfTier,
}: {
  sso: boolean;
  ownsTeamWorkspace: boolean;
  shelfTier?: PurchaseTier;
}): boolean {
  if (!sso) return true;
  if (shelfTier === "tier_1") return false;
  return ownsTeamWorkspace;
}

/**
 * Throws unless the user may start a purchase.
 *
 * The workspace count is only queried for SSO users, since the rule ignores it
 * for everyone else.
 *
 * @param args.userId - The signed-in user starting the purchase
 * @param args.shelfTier - The plan being purchased, when known
 * @throws {ShelfError} 403 (not captured) when the rule refuses the purchase
 */
export async function assertUserMayPurchase({
  userId,
  shelfTier,
}: {
  userId: string;
  shelfTier?: PurchaseTier;
}): Promise<void> {
  const { sso } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sso: true },
  });

  const ownsTeamWorkspace = sso
    ? (await db.organization.count({ where: { userId, type: "TEAM" } })) > 0
    : false;

  if (!ssoUserMayPurchase({ sso, ownsTeamWorkspace, shelfTier })) {
    throw new ShelfError({
      cause: null,
      message: PURCHASES_UNAVAILABLE_MESSAGE,
      title: "Purchases unavailable",
      status: 403,
      shouldBeCaptured: false,
      additionalData: { userId, shelfTier },
      label: "Subscription",
    });
  }
}
