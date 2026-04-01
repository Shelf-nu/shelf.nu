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
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { makeShelfError } from "~/utils/error";
import { error, parseData, payload } from "~/utils/http.server";
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

    return data(
      payload({
        auditPrices,
        barcodePrices,
        usedAuditTrial,
        usedBarcodeTrial,
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

    // Get the personal org with trial flags to prevent duplicate trials
    const personalOrg = await db.organization.findFirstOrThrow({
      where: { owner: { is: { id: userId } }, type: "PERSONAL" },
      select: {
        id: true,
        usedAuditTrial: true,
        usedBarcodeTrial: true,
      },
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

    // Create audit trial if selected (skip if already used)
    if (auditPriceId && !personalOrg.usedAuditTrial) {
      const { hasPaymentMethod } = await createAuditAddonTrialSubscription({
        customerId,
        priceId: auditPriceId,
        userId,
        organizationId: personalOrg.id,
      });

      await db.organization.update({
        where: { id: personalOrg.id },
        data: {
          auditsEnabled: true,
          usedAuditTrial: true,
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

    // Create barcode trial if selected (skip if already used)
    if (barcodePriceId && !personalOrg.usedBarcodeTrial) {
      const { hasPaymentMethod } = await createBarcodeAddonTrialSubscription({
        customerId,
        priceId: barcodePriceId,
        userId,
        organizationId: personalOrg.id,
      });

      await db.organization.update({
        where: { id: personalOrg.id },
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
      />
    </div>
  );
}
