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
import {
  createAuditAddonTrialSubscription,
  getAuditAddonPrices,
} from "~/modules/audit/addon.server";
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
    const auditPrices = await getAuditAddonPrices();

    // Get personal org to check if audit trial was already used
    let usedAuditTrial = false;
    try {
      const personalOrg = await getOrganizationByUserId({
        userId,
        orgType: "PERSONAL",
      });
      const orgData = await db.organization.findUnique({
        where: { id: personalOrg.id },
        select: { usedAuditTrial: true },
      });
      usedAuditTrial = orgData?.usedAuditTrial ?? false;
    } catch {
      // Personal org not found yet - that's ok during onboarding
    }

    return data(
      payload({
        auditPrices,
        usedAuditTrial,
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
    const { intent, auditPriceId } = parseData(
      await request.formData(),
      z.object({
        intent: z.literal("personal-with-audits"),
        auditPriceId: z.string().min(1, "Audit price is required"),
      })
    );

    if (intent !== "personal-with-audits") {
      throw new Error("Invalid intent");
    }

    // Get the personal org
    const personalOrg = await getOrganizationByUserId({
      userId,
      orgType: "PERSONAL",
    });

    const user = await getUserByID(userId, {
      select: {
        id: true,
        email: true,
        customerId: true,
        firstName: true,
        lastName: true,
      } satisfies Prisma.UserSelect,
    });

    const customerId = await getOrCreateCustomerId(user);

    // Create the audit trial subscription with user's chosen billing cycle
    const { hasPaymentMethod } = await createAuditAddonTrialSubscription({
      customerId,
      priceId: auditPriceId,
      userId,
      organizationId: personalOrg.id,
    });

    // Enable audits on the personal org
    await db.organization.update({
      where: { id: personalOrg.id },
      data: {
        auditsEnabled: true,
        usedAuditTrial: true,
        auditsEnabledAt: new Date(),
      },
      select: { id: true },
    });

    // Send welcome email
    void sendAuditTrialWelcomeEmail({
      firstName: user.firstName,
      email,
      hasPaymentMethod,
    });

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
        usedAuditTrial={loaderData?.usedAuditTrial ?? false}
      />
    </div>
  );
}
