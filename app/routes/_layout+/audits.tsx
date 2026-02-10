import type { Prisma } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  ShouldRevalidateFunctionArgs,
} from "react-router";
import { data, Link, Outlet, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { UnlockAuditsPage } from "~/components/audit/unlock-audits-page";
import { ErrorContent } from "~/components/errors";
import { db } from "~/database/db.server";
import { sendAuditTrialWelcomeEmail } from "~/emails/stripe/audit-trial-welcome";
import {
  createAuditAddonCheckoutSession,
  createAuditAddonTrialSubscription,
  getAuditAddonPrices,
} from "~/modules/audit/addon.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { error, parseData } from "~/utils/http.server";
import { getDomainUrl, getOrCreateCustomerId } from "~/utils/stripe.server";
import { canUseAudits } from "~/utils/subscription.server";

export const meta = () => [{ title: appendToMetaTitle("Audits") }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations, userOrganizations } =
      await getSelectedOrganization({ userId, request });

    const currentUserRoles = userOrganizations.find(
      (uo) => uo.organizationId === organizationId
    )?.roles;
    const isOwner = currentUserRoles?.includes("OWNER") ?? false;

    const orgTierLimit = await getOrganizationTierLimit({
      organizationId,
      organizations,
    });

    const hasAccess = canUseAudits(orgTierLimit);

    // Only fetch prices when the user doesn't have access
    const prices = hasAccess
      ? { month: null, year: null }
      : await getAuditAddonPrices();

    const hasPaidSubscription = ["tier_1", "tier_2"].includes(
      orgTierLimit.tierId
    );

    return data({
      canUseAudits: hasAccess,
      isOwner,
      usedAuditTrial: orgTierLimit.usedAuditTrial,
      hasPaidSubscription,
      monthlyPrice: prices.month,
      yearlyPrice: prices.year,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    const { priceId, intent } = parseData(
      await request.formData(),
      z.object({
        priceId: z.string(),
        intent: z.enum(["trial", "subscribe"]),
      })
    );

    const user = await getUserByID(userId, {
      select: {
        customerId: true,
        firstName: true,
        lastName: true,
        usedAuditTrial: true,
        tierId: true,
      } satisfies Prisma.UserSelect,
    });

    const customerId = await getOrCreateCustomerId({
      id: userId,
      email,
      ...user,
    });

    if (intent === "trial") {
      // Validate user has a paid subscription and hasn't used trial
      if (user.usedAuditTrial) {
        throw new Error("You have already used your free audit trial.");
      }

      if (!["tier_1", "tier_2"].includes(user.tierId)) {
        throw new Error(
          "Free trial is only available for Plus or Team subscribers."
        );
      }

      // Create trial subscription directly via Stripe API
      const { hasPaymentMethod } = await createAuditAddonTrialSubscription({
        customerId,
        priceId,
        userId,
      });

      // Set flags immediately (webhook also fires as backup)
      await db.user.update({
        where: { id: userId },
        data: {
          hasAuditAddon: true,
          usedAuditTrial: true,
        },
        select: { id: true },
      });

      void sendAuditTrialWelcomeEmail({
        firstName: user.firstName,
        email,
        hasPaymentMethod,
      });

      return redirect("/audits");
    }

    // intent === "subscribe"
    const domainUrl = getDomainUrl(request);
    const stripeRedirectUrl = await createAuditAddonCheckoutSession({
      priceId,
      userId,
      domainUrl,
      customerId,
    });

    return redirect(stripeRedirectUrl);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  /**
   * If we are toggling the sidebar, no need to revalidate this loader.
   * Revalidation happens in _layout
   */
  if (actionResult?.isTogglingSidebar) {
    return false;
  }

  return defaultShouldRevalidate;
}

export const handle = {
  breadcrumb: () => <Link to="/audits">Audits</Link>,
};

export default function AuditsPage() {
  const {
    canUseAudits,
    isOwner,
    usedAuditTrial,
    hasPaidSubscription,
    monthlyPrice,
    yearlyPrice,
  } = useLoaderData<typeof loader>();

  if (!canUseAudits) {
    return (
      <UnlockAuditsPage
        isOwner={isOwner}
        usedAuditTrial={usedAuditTrial}
        hasPaidSubscription={hasPaidSubscription}
        monthlyPrice={monthlyPrice}
        yearlyPrice={yearlyPrice}
      />
    );
  }

  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
