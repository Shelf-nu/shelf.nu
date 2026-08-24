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
  getAuditSubscriptionInfo,
} from "~/modules/audit/addon.server";
import {
  claimAddonTrial,
  releaseAddonTrial,
} from "~/modules/billing/addon-trial-claim.server";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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
import { canUseAudits } from "~/utils/subscription.server";

export const meta = () => [{ title: appendToMetaTitle("Audits") }];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    const { organizationId, currentOrganization, userOrganizations } =
      await getSelectedOrganization({ userId, request });

    const currentUserRoles = userOrganizations.find(
      (uo) => uo.organizationId === organizationId
    )?.roles;
    const isOwner = currentUserRoles?.includes("OWNER") ?? false;

    const hasAccess = canUseAudits(currentOrganization);

    // Only fetch prices when the user doesn't have access
    const prices = hasAccess
      ? { month: null, year: null }
      : await getAuditAddonPrices();

    const canStartTrial =
      isOwner && !currentOrganization.usedAuditTrial && !hasAccess;
    const trialExpired = currentOrganization.usedAuditTrial && !hasAccess;

    let hasPaymentMethod = false;
    let auditSubInfo: {
      interval: "month" | "year";
      amount: number;
      currency: string;
      status: string;
    } | null = null;

    // For trial CTA, check payment method without creating a Stripe customer
    if (canStartTrial) {
      const user = await getUserByID(userId, {
        select: { customerId: true } satisfies Prisma.UserSelect,
      });
      if (user.customerId) {
        hasPaymentMethod = await customerHasPaymentMethod(user.customerId);
      }
    }

    // For expired trial, we need the full customer to fetch subscription info
    if (trialExpired) {
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
      const customerId = await getOrCreateCustomerId({
        ...user,
        email: user.email || email,
      });
      auditSubInfo = await getAuditSubscriptionInfo({ customerId });
    }

    return data({
      canUseAudits: hasAccess,
      isOwner,
      usedAuditTrial: currentOrganization.usedAuditTrial,
      monthlyPrice: prices.month,
      yearlyPrice: prices.year,
      auditSubInfo,
      hasPaymentMethod,
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
      action: "start or buy the audits add-on",
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
        addon: "audits",
      });

      if (!claimedTrial) {
        throw new ShelfError({
          cause: null,
          message: "This workspace has already used the free audit trial.",
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
        ({ hasPaymentMethod } = await createAuditAddonTrialSubscription({
          customerId,
          priceId,
          userId,
          organizationId,
        }));
      } catch (cause) {
        await releaseAddonTrial({ organizationId, addon: "audits" }).catch(
          (releaseCause: unknown) => {
            // Report why the trial did not start, not why the bookkeeping
            // afterwards failed.
            Logger.error(
              new ShelfError({
                cause: releaseCause,
                message: "Failed to release an unclaimed audit trial",
                additionalData: { organizationId },
                label: "Stripe",
              })
            );
          }
        );
        throw cause;
      }

      // Enable the add-on (webhook also fires as backup). `usedAuditTrial` is
      // owned by the claim above and deliberately not rewritten here.
      await db.organization.update({
        where: { id: organizationId },
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

      return redirect("/audits");
    }

    // intent === "subscribe"
    const domainUrl = getDomainUrl(request);
    const stripeRedirectUrl = await createAuditAddonCheckoutSession({
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
    monthlyPrice,
    yearlyPrice,
    auditSubInfo,
    hasPaymentMethod,
  } = useLoaderData<typeof loader>();

  if (!canUseAudits) {
    return (
      <UnlockAuditsPage
        isOwner={isOwner}
        usedAuditTrial={usedAuditTrial}
        monthlyPrice={monthlyPrice}
        yearlyPrice={yearlyPrice}
        auditSubInfo={auditSubInfo}
        hasPaymentMethod={hasPaymentMethod}
      />
    );
  }

  return <Outlet />;
}

export const ErrorBoundary = () => <ErrorContent />;
