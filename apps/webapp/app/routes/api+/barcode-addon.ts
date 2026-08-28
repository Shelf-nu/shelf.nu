import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { sendBarcodeTrialWelcomeEmail } from "~/emails/stripe/barcode-trial-welcome";
import {
  createBarcodeAddonCheckoutSession,
  createBarcodeAddonTrialSubscription,
} from "~/modules/barcode/addon.server";
import {
  claimAddonTrial,
  mayHaveCreatedSubscription,
  releaseAddonTrial,
} from "~/modules/billing/addon-trial-claim.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, error, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import {
  assertIsOrganizationOwner,
  requirePermission,
} from "~/utils/roles.server";
import {
  customerHasPaymentMethod,
  getDomainUrl,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";
import { resolveUserGreetingName } from "~/utils/user";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    assertIsPost(request);

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.subscription,
      action: PermissionAction.update,
    });

    const { priceId, intent, consentAcknowledged } = parseData(
      await request.formData(),
      z.object({
        priceId: z.string(),
        intent: z.enum(["trial", "subscribe"]),
        consentAcknowledged: z
          .string()
          .transform((v) => v === "true")
          .optional(),
      })
    );

    // `currentOrganization` is deliberately not taken here: the only thing the
    // action used it for was the trial flag, and that is now decided by
    // claiming the trial rather than by reading a value that can go stale
    // between the read and the Stripe call.
    const { organizationId, userOrganizations } = await getSelectedOrganization(
      { userId, request }
    );

    // `subscription:update` is not enough here. ADMIN short-circuits to
    // allow-all in `hasPermission`, so it clears that gate -- but this spends
    // money on the owner's card and burns the workspace's ONE free trial, an
    // irreversible flag. The purchase UI is owner-only; this makes the action
    // agree with it.
    assertIsOrganizationOwner({
      userOrganizations,
      organizationId,
      action: "start or buy the barcodes add-on",
    });

    const user = await getUserByID(userId, {
      select: {
        customerId: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });

    const customerId = await getOrCreateCustomerId({
      id: userId,
      email,
      ...user,
    });

    if (intent === "trial") {
      // Claim the one-time trial before talking to Stripe. Reading the flag
      // and writing it after the subscription call leaves a window as wide as
      // a network round trip, and two requests inside it both create a real
      // subscription. The claim is the check — exactly one caller wins.
      const claimedTrial = await claimAddonTrial({
        organizationId,
        addon: "barcodes",
      });

      if (!claimedTrial) {
        throw new ShelfError({
          cause: null,
          message: "This workspace has already used the free barcode trial.",
          status: 400,
          label: "Stripe",
          shouldBeCaptured: false,
        });
      }

      // Everything from here on can fail with the trial already claimed, so
      // it runs under a release: a refused consent or a Stripe error must not
      // cost the workspace a trial it never got.
      let hasPaymentMethod: boolean;
      try {
        // Server-side consent validation when payment method exists
        const hasPaymentMethodOnFile =
          await customerHasPaymentMethod(customerId);
        if (hasPaymentMethodOnFile && !consentAcknowledged) {
          throw new ShelfError({
            cause: null,
            message:
              "You must acknowledge the auto-charge terms before starting a trial.",
            status: 400,
            label: "Stripe",
            shouldBeCaptured: false,
          });
        }

        // Create trial subscription directly via Stripe API
        ({ hasPaymentMethod } = await createBarcodeAddonTrialSubscription({
          customerId,
          priceId,
          userId,
          organizationId,
        }));
      } catch (cause) {
        // A refusal Stripe never received is safe to undo. An ambiguous failure
        // is not: the subscription may exist and only its response was lost, so
        // handing the trial back would let a retry open a second one.
        if (!mayHaveCreatedSubscription(cause)) {
          await releaseAddonTrial({
            organizationId: organizationId,
            addon: "barcodes",
          }).catch((releaseCause: unknown) => {
            // Report why the trial did not start, not why the bookkeeping
            // afterwards failed.
            Logger.error(
              new ShelfError({
                cause: releaseCause,
                message: "Failed to release an unclaimed barcode trial",
                additionalData: { organizationId: organizationId },
                label: "Stripe",
              })
            );
          });
        }
        throw cause;
      }

      // Enable the add-on (webhook also fires as backup). `usedBarcodeTrial`
      // is owned by the claim above and deliberately not rewritten here.
      await db.organization.update({
        where: { id: organizationId },
        data: {
          barcodesEnabled: true,
          barcodesEnabledAt: new Date(),
        },
        select: { id: true },
      });

      void sendBarcodeTrialWelcomeEmail({
        firstName: resolveUserGreetingName(user),
        email,
        hasPaymentMethod,
      });

      // Redirect back to wherever the user came from
      const referer = request.headers.get("Referer");
      let redirectPath = "/assets";
      if (referer) {
        try {
          redirectPath = new URL(referer).pathname;
        } catch {
          // Malformed Referer header — fall back to /assets
        }
      }
      return redirect(redirectPath);
    }

    // intent === "subscribe"
    const domainUrl = getDomainUrl(request);
    const stripeRedirectUrl = await createBarcodeAddonCheckoutSession({
      priceId,
      userId,
      domainUrl,
      customerId,
      organizationId,
    });

    return redirect(stripeRedirectUrl);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
