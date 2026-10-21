/**
 * SSO purchase gate.
 *
 * Institutions that sign their members in through SSO need a guarantee that
 * those members cannot buy a subscription. A user flagged `sso` may start a
 * purchase only for a Team plan and only when they own a TEAM workspace (the
 * workspace owner is `Organization.userId`). Billing their personal workspace
 * is always refused. Everyone else is unaffected. The target is required so a
 * caller can never fall through to an owner check by omission.
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

/**
 * Which workspace a purchase bills. "personal" is the user's own personal
 * workspace (Plus, onboarding add-on trials); "team" is a Team plan.
 */
export type PurchaseTarget = "personal" | "team";

/**
 * Decides whether a user may start a purchase.
 *
 * @param args.sso - Whether the user signs in through SSO
 * @param args.ownsTeamWorkspace - Whether the user owns at least one TEAM workspace
 * @param args.target - The workspace the purchase bills
 * @returns `true` for non-SSO users. For SSO users, `false` for "personal",
 * otherwise whether they own a TEAM workspace.
 */
export function ssoUserMayPurchase({
  sso,
  ownsTeamWorkspace,
  target,
}: {
  sso: boolean;
  ownsTeamWorkspace: boolean;
  target: PurchaseTarget;
}): boolean {
  if (!sso) return true;
  if (target === "personal") return false;
  return ownsTeamWorkspace;
}

/**
 * Throws unless the user may start a purchase.
 *
 * The workspace count is only queried for SSO users buying a Team plan, since
 * the rule ignores it in every other case.
 *
 * @param args.userId - The signed-in user starting the purchase
 * @param args.target - The workspace the purchase bills
 * @throws {ShelfError} 403 (not captured) when the rule refuses the purchase
 */
export async function assertUserMayPurchase({
  userId,
  target,
}: {
  userId: string;
  target: PurchaseTarget;
}): Promise<void> {
  const { sso } = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { sso: true },
  });

  const ownsTeamWorkspace =
    sso && target === "team"
      ? (await db.organization.count({ where: { userId, type: "TEAM" } })) > 0
      : false;

  if (!ssoUserMayPurchase({ sso, ownsTeamWorkspace, target })) {
    throw new ShelfError({
      cause: null,
      message: PURCHASES_UNAVAILABLE_MESSAGE,
      title: "Purchases unavailable",
      status: 403,
      shouldBeCaptured: false,
      additionalData: { userId, target },
      label: "Subscription",
    });
  }
}
