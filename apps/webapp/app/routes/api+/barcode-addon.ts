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
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import {
  customerHasPaymentMethod,
  getDomainUrl,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";

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

    const { organizationId, currentOrganization } =
      await getSelectedOrganization({ userId, request });

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
      // Validate organization hasn't already used trial
      if (currentOrganization.usedBarcodeTrial) {
        throw new ShelfError({
          cause: null,
          message: "This workspace has already used the free barcode trial.",
          status: 400,
          label: "Stripe",
          shouldBeCaptured: false,
        });
      }

      // Server-side consent validation when payment method exists
      const hasPaymentMethodOnFile = await customerHasPaymentMethod(customerId);
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
      const { hasPaymentMethod } = await createBarcodeAddonTrialSubscription({
        customerId,
        priceId,
        userId,
        organizationId,
      });

      // Set flags immediately on the organization (webhook also fires as backup)
      await db.organization.update({
        where: { id: organizationId },
        data: {
          barcodesEnabled: true,
          usedBarcodeTrial: true,
          barcodesEnabledAt: new Date(),
        },
        select: { id: true },
      });

      void sendBarcodeTrialWelcomeEmail({
        firstName: user.firstName,
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
