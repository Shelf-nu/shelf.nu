import type { Prisma } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { ChoosePurpose } from "~/components/welcome/choose-purpose";
import { db } from "~/database/db.server";
import { sendAuditTrialWelcomeEmail } from "~/emails/stripe/audit-trial-welcome";
import { sendBarcodeTrialWelcomeEmail } from "~/emails/stripe/barcode-trial-welcome";
import {
  createAuditAddonTrialSubscription,
  getAuditAddonPrices,
} from "~/modules/audit/addon.server";
import {
  createBarcodeAddonTrialSubscription,
  getBarcodeAddonPrices,
} from "~/modules/barcode/addon.server";
import {
  claimAddonTrial,
  mayHaveCreatedSubscription,
  releaseAddonTrial,
} from "~/modules/billing/addon-trial-claim.server";
import { signalsTeamIntent } from "~/modules/onboarding/constants";
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, parseData, payload } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { getOrCreateCustomerId } from "~/utils/stripe.server";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export async function loader({ context }: LoaderFunctionArgs) {
  if (!ENABLE_PREMIUM_FEATURES) {
    return redirect("/assets");
  }

  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const [auditPrices, barcodePrices] = await Promise.all([
      getAuditAddonPrices(),
      getBarcodeAddonPrices(),
    ]);

    // Get personal org to check if addon trials were already used
    let usedAuditTrial = false;
    let usedBarcodeTrial = false;
    try {
      const personalOrg = await getOrganizationByUserId({
        userId,
        orgType: "PERSONAL",
      });
      const orgData = await db.organization.findUnique({
        where: { id: personalOrg.id },
        select: { usedAuditTrial: true, usedBarcodeTrial: true },
      });
      usedAuditTrial = orgData?.usedAuditTrial ?? false;
      usedBarcodeTrial = orgData?.usedBarcodeTrial ?? false;
    } catch {
      // Personal org not found yet - that's ok during onboarding
    }

    // Read the onboarding "how many people" answer so we can steer the plan
    // choice. Only the known multi-person options count: the field is
    // free-text capable, so answers like "1" must not imply a team.
    const userWithIntel = await getUserByID(userId, {
      select: {
        businessIntel: { select: { teamSize: true } },
      } satisfies Prisma.UserSelect,
    });
    const teamSize = userWithIntel.businessIntel?.teamSize ?? null;
    const teamIntent =
      teamSize && signalsTeamIntent(teamSize) ? { teamSize } : null;

    return data(
      payload({
        auditPrices,
        barcodePrices,
        usedAuditTrial,
        usedBarcodeTrial,
        teamIntent,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    const { intent, auditPriceId, barcodePriceId } = parseData(
      await request.formData(),
      z.object({
        intent: z.literal("personal-with-addons"),
        auditPriceId: z.string().optional(),
        barcodePriceId: z.string().optional(),
      })
    );

    if (intent !== "personal-with-addons") {
      throw new Error("Invalid intent");
    }

    // The trial flags are deliberately NOT selected here: whether a trial is
    // still available is decided by claiming it, not by reading it first.
    const personalOrg = await db.organization.findFirstOrThrow({
      where: { owner: { is: { id: userId } }, type: "PERSONAL" },
      select: { id: true },
    });

    const user = await getUserByID(userId, {
      select: {
        id: true,
        email: true,
        customerId: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });

    const customerId = await getOrCreateCustomerId(user);

    // Create audit trial if selected. Claiming the one-time trial is what
    // decides whether to proceed: reading the flag and writing it after the
    // Stripe call leaves a window as wide as a network round trip, and two
    // submissions inside it both create a real subscription. A lost claim
    // means someone else is already creating this trial, so this request has
    // nothing to do — onboarding continues rather than failing.
    if (
      auditPriceId &&
      (await claimAddonTrial({
        organizationId: personalOrg.id,
        addon: "audits",
      }))
    ) {
      let hasPaymentMethod: boolean;
      try {
        ({ hasPaymentMethod } = await createAuditAddonTrialSubscription({
          customerId,
          priceId: auditPriceId,
          userId,
          organizationId: personalOrg.id,
        }));
      } catch (cause) {
        // A refusal Stripe never received is safe to undo. An ambiguous
        // failure is not: the subscription may exist and only its response
        // was lost, so handing the trial back would let a retry open a
        // second one.
        if (!mayHaveCreatedSubscription(cause)) {
          await releaseAddonTrial({
            organizationId: personalOrg.id,
            addon: "audits",
          }).catch((releaseCause: unknown) => {
            Logger.error(
              new ShelfError({
                cause: releaseCause,
                message: "Failed to release an unclaimed audit trial",
                additionalData: { organizationId: personalOrg.id },
                label: "Stripe",
              })
            );
          });
        }
        throw cause;
      }

      // `usedAuditTrial` is owned by the claim above.
      await db.organization.update({
        where: { id: personalOrg.id },
        data: {
          auditsEnabled: true,
          auditsEnabledAt: new Date(),
        },
        select: { id: true },
      });

      void sendAuditTrialWelcomeEmail({
        firstName: user.firstName,
        displayName: user.displayName,
        email,
        hasPaymentMethod,
      });
    }

    // Same claim-then-create rule as the audit trial above.
    if (
      barcodePriceId &&
      (await claimAddonTrial({
        organizationId: personalOrg.id,
        addon: "barcodes",
      }))
    ) {
      let hasPaymentMethod: boolean;
      try {
        ({ hasPaymentMethod } = await createBarcodeAddonTrialSubscription({
          customerId,
          priceId: barcodePriceId,
          userId,
          organizationId: personalOrg.id,
        }));
      } catch (cause) {
        // A refusal Stripe never received is safe to undo. An ambiguous
        // failure is not: the subscription may exist and only its response
        // was lost, so handing the trial back would let a retry open a
        // second one.
        if (!mayHaveCreatedSubscription(cause)) {
          await releaseAddonTrial({
            organizationId: personalOrg.id,
            addon: "barcodes",
          }).catch((releaseCause: unknown) => {
            Logger.error(
              new ShelfError({
                cause: releaseCause,
                message: "Failed to release an unclaimed barcode trial",
                additionalData: { organizationId: personalOrg.id },
                label: "Stripe",
              })
            );
          });
        }
        throw cause;
      }

      // `usedBarcodeTrial` is owned by the claim above.
      await db.organization.update({
        where: { id: personalOrg.id },
        data: {
          barcodesEnabled: true,
          barcodesEnabledAt: new Date(),
        },
        select: { id: true },
      });

      void sendBarcodeTrialWelcomeEmail({
        firstName: user.firstName,
        email,
        hasPaymentMethod,
      });
    }

    return redirect("/assets");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export default function Welcome() {
  const loaderData = useLoaderData<typeof loader>();

  return (
    <div>
      <ChoosePurpose
        auditPrices={loaderData?.auditPrices ?? { month: null, year: null }}
        barcodePrices={loaderData?.barcodePrices ?? { month: null, year: null }}
        usedAuditTrial={loaderData?.usedAuditTrial ?? false}
        usedBarcodeTrial={loaderData?.usedBarcodeTrial ?? false}
        teamIntent={loaderData?.teamIntent ?? null}
        defaultSelectedPlan={loaderData?.teamIntent ? "team" : null}
      />
    </div>
  );
}
