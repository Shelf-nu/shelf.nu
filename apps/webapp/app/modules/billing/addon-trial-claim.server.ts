/**
 * Add-on Trial Claim
 *
 * Each workspace gets one free trial per add-on, tracked by a boolean on
 * `Organization` (`usedAuditTrial`, `usedBarcodeTrial`). Starting a trial means
 * creating a real Stripe subscription, so "have we used it yet" has to be
 * decided once and only once — reading the flag, calling Stripe, then writing
 * the flag leaves a window as wide as a network round trip, and two requests
 * that arrive inside it both see an unused trial and both create a
 * subscription. That is two real subscriptions on one workspace.
 *
 * The claim closes that window: a single conditional `UPDATE` both tests the
 * flag and sets it, which Postgres serializes on the row. Exactly one caller
 * is told it won, and only that caller talks to Stripe.
 *
 * @see {@link file://./../../routes/_layout+/audits.tsx}
 * @see {@link file://./../../routes/api+/barcode-addon.ts}
 * @see {@link file://./../../routes/_welcome+/welcome.tsx}
 */

import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";

const label: ErrorLabel = "Stripe";

/** The add-ons that offer a one-time free trial per workspace. */
export type AddonTrialKind = "audits" | "barcodes";

/**
 * The `Organization` column tracking each add-on's one-time trial.
 *
 * Keyed by add-on rather than passed in, so a caller cannot ask to claim one
 * add-on's trial while spending another's.
 */
const USED_TRIAL_FIELD = {
  audits: "usedAuditTrial",
  barcodes: "usedBarcodeTrial",
} as const satisfies Record<AddonTrialKind, string>;

/**
 * Claims a workspace's one-time trial for an add-on.
 *
 * Call this BEFORE creating the Stripe subscription and act only on `true`.
 * Checking the flag with a separate read first does not help and is not
 * needed — the claim is the check.
 *
 * On any failure after a successful claim, call {@link releaseAddonTrial} so a
 * Stripe error does not cost the workspace its trial.
 *
 * @param params.organizationId - Workspace claiming the trial
 * @param params.addon - Which add-on's trial to claim
 * @returns `true` if this caller took the trial, `false` if it was already
 *   taken — by an earlier request or by one racing this same call
 * @throws {ShelfError} If the update fails
 */
export async function claimAddonTrial({
  organizationId,
  addon,
}: {
  organizationId: string;
  addon: AddonTrialKind;
}): Promise<boolean> {
  const field = USED_TRIAL_FIELD[addon];

  try {
    // `updateMany` rather than `update`: the predicate carries the condition,
    // and a row that no longer matches reports zero updated instead of
    // throwing. That count IS the answer — one means this caller claimed it.
    const { count } = await db.organization.updateMany({
      where: { id: organizationId, [field]: false },
      data: { [field]: true },
    });

    return count === 1;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while starting your trial. Please try again later or contact support.",
      additionalData: { organizationId, addon },
      label,
    });
  }
}

/**
 * Whether a failed trial attempt may have left a real subscription at Stripe.
 *
 * `subscriptions.create` failing does not mean nothing was created: a lost
 * response looks exactly like a refusal from the caller's side. The add-on
 * helpers record whether the request had been sent, and that is the only safe
 * basis for deciding whether to hand the trial back — releasing it after an
 * ambiguous failure lets a retry open a SECOND subscription, which is the
 * outcome the claim exists to prevent.
 *
 * Unknown shapes count as attempted. A trial wrongly kept costs the workspace
 * a free week and a support message; a trial wrongly released costs them a
 * duplicate subscription.
 *
 * @param cause - The error thrown while creating the trial
 * @returns `true` when a subscription may exist, so the claim must stand
 */
export function mayHaveCreatedSubscription(cause: unknown): boolean {
  // A 4xx from the add-on helper is its own pre-flight validation (an invalid
  // price, a missing Stripe client) and is rethrown before the request goes
  // out, so nothing can exist yet.
  if (cause instanceof ShelfError && (cause.status ?? 500) < 500) {
    return false;
  }

  if (cause instanceof ShelfError) {
    const attempted = cause.additionalData?.subscriptionCreateAttempted;
    return attempted !== false;
  }

  return true;
}

/**
 * Returns a claimed trial to the workspace after the trial could not be
 * started.
 *
 * Only the caller that claimed it may release it, and only for a failure that
 * provably happened before Stripe was asked to create anything — see
 * {@link mayHaveCreatedSubscription}.
 *
 * A release failure is logged by the caller rather than replacing the original
 * error: what the user needs to hear is why their trial did not start.
 *
 * @param params.organizationId - Workspace whose trial is being returned
 * @param params.addon - Which add-on's trial to return
 * @throws {ShelfError} If the update fails
 */
export async function releaseAddonTrial({
  organizationId,
  addon,
}: {
  organizationId: string;
  addon: AddonTrialKind;
}): Promise<void> {
  const field = USED_TRIAL_FIELD[addon];

  try {
    await db.organization.updateMany({
      where: { id: organizationId, [field]: true },
      data: { [field]: false },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to release an unused add-on trial claim",
      additionalData: { organizationId, addon },
      label,
    });
  }
}
