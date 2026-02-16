import type { CustomTierLimit, Prisma } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, Link, useLoaderData } from "react-router";
import { z } from "zod";
import { InfoIcon } from "~/components/icons/library";
import { CrispButton } from "~/components/marketing/crisp";
import { Button } from "~/components/shared/button";

import { DateS } from "~/components/shared/date";
import { WarningBox } from "~/components/shared/warning-box";
import { CustomerPortalForm } from "~/components/subscription/customer-portal-form";
import type { PaidInvoice } from "~/components/subscription/invoice-history";
import { InvoiceHistory } from "~/components/subscription/invoice-history";
import { PricingTable } from "~/components/subscription/pricing-table";
import { SubscriptionsOverview } from "~/components/subscription/subscriptions-overview";
import SuccessfulSubscriptionModal from "~/components/subscription/successful-subscription-modal";
import { db } from "~/database/db.server";
import { sendTeamTrialWelcomeEmail } from "~/emails/stripe/welcome-to-trial";
import { useUserData } from "~/hooks/use-user-data";
import { getUserTierLimit } from "~/modules/tier/service.server";

import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  getDomainUrl,
  getStripePricesAndProducts,
  createStripeCheckoutSession,
  createTeamTrialSubscription,
  generateReturnUrl,
  getCustomerOpenInvoices,
  getCustomerPaidInvoices,
  getCustomerUpcomingInvoices,
  getCustomerSubscriptionsWithProducts,
  getStripeCustomer,
  getOrCreateCustomerId,
} from "~/utils/stripe.server";

export async function loader({ context }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    if (!ENABLE_PREMIUM_FEATURES) {
      return redirect("/account-details/general");
    }
    /**
     * NOTE: all users should be able to access the subscription route no matter which role they have
     * as its their own account settings.
     */
    const [user, tierLimit] = await Promise.all([
      getUserByID(userId, {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          customerId: true,
          tierId: true,
          usedFreeTrial: true,
        } satisfies Prisma.UserSelect,
      }),
      getUserTierLimit(userId),
    ]);

    /** Get the Stripe customer */
    const customer = (await getStripeCustomer(
      await getOrCreateCustomerId(user)
    )) as CustomerWithSubscriptions;

    /* Get the prices, products, subscriptions, and invoices from Stripe */
    const [
      prices,
      openInvoices,
      paidInvoicesData,
      upcomingInvoicesData,
      subscriptionsWithProducts,
    ] = await Promise.all([
      getStripePricesAndProducts(),
      getCustomerOpenInvoices(customer.id),
      getCustomerPaidInvoices(customer.id),
      getCustomerUpcomingInvoices(customer),
      getCustomerSubscriptionsWithProducts(customer.id),
    ]);

    // Transform paid invoices to simplified type for UI
    const paidInvoices: PaidInvoice[] = paidInvoicesData.map((inv) => ({
      id: inv.id,
      number: inv.number,
      amountPaid: inv.amount_paid,
      currency: inv.currency,
      paidAt: inv.status_transitions?.paid_at ?? null,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    }));

    // Transform upcoming invoices to simplified type for UI
    // Get subscription name from the customer's subscriptions data
    const upcomingInvoices = upcomingInvoicesData.map((inv) => {
      // In Stripe API 2026-01-28, subscription moved to parent.subscription_details
      const subscriptionId =
        (inv.parent?.subscription_details?.subscription as string) ?? "";

      // Find the subscription in customer data to get its name
      const subscription = customer.subscriptions?.data.find(
        (sub) => sub.id === subscriptionId
      );

      // Get the product name from the first line item description or subscription item
      let subscriptionName = "Subscription";
      if (inv.lines?.data?.[0]?.description) {
        subscriptionName = inv.lines.data[0].description;
      } else if (subscription?.items?.data?.[0]?.price?.nickname) {
        subscriptionName = subscription.items.data[0].price.nickname;
      }

      return {
        subscriptionId,
        subscriptionName,
        amountDue: inv.amount_due,
        currency: inv.currency,
        periodEnd: inv.period_end,
      };
    });

    return payload({
      title: `Subscriptions`,
      subTitle:
        customer?.subscriptions.data.length === 0
          ? "Pick an account plan that fits your workflow."
          : "Manage your account plan.",
      tier: user.tierId,
      tierLimit,
      prices,
      customer,
      subscriptionsWithProducts,
      usedFreeTrial: user.usedFreeTrial,
      openInvoices: openInvoices.map((inv) => {
        // Get subscription name from line items description
        let subscriptionName = "Subscription";
        if (inv.lines?.data?.[0]?.description) {
          subscriptionName = inv.lines.data[0].description;
        }

        return {
          number: inv.number,
          subscriptionName,
          amountDue: inv.amount_due,
          currency: inv.currency,
          // Use due_date if available, otherwise fall back to period_end
          dueDate: inv.due_date ?? inv.period_end,
          hostedInvoiceUrl: inv.hosted_invoice_url,
        };
      }),
      paidInvoices,
      upcomingInvoices,
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
    const { priceId, intent, shelfTier, auditPriceId } = parseData(
      await request.formData(),
      z.object({
        priceId: z.string(),
        intent: z.enum(["trial", "subscribe"]),
        shelfTier: z.enum(["tier_1", "tier_2"]),
        auditPriceId: z.string().optional(),
      })
    );

    const user = await getUserByID(userId, {
      select: {
        customerId: true,
        firstName: true,
        lastName: true,
        usedFreeTrial: true,
      } satisfies Prisma.UserSelect,
    });

    const customerId = await getOrCreateCustomerId({
      id: userId,
      email,
      ...user,
    });
    const domainUrl = getDomainUrl(request);

    if (intent === "trial") {
      // Prevent duplicate trials — UI hides the button but this
      // guards against double-submits and direct POST requests
      if (user.usedFreeTrial) {
        throw new ShelfError({
          cause: null,
          message: "You have already used your free trial.",
          label: "Subscription",
          shouldBeCaptured: false,
          status: 400,
        });
      }

      // Create subscription directly via Stripe API — no checkout needed
      await createTeamTrialSubscription({
        customerId,
        priceId,
        userId,
        auditPriceId,
      });

      // Update user tier and mark trial as used
      await db.user.update({
        where: { id: userId },
        data: { tierId: shelfTier, usedFreeTrial: true },
        select: { id: true },
      });

      // Send welcome email (fire-and-forget)
      void sendTeamTrialWelcomeEmail({
        firstName: user.firstName,
        email,
      });

      const returnUrl = await generateReturnUrl({
        userId,
        shelfTier,
        intent,
        domainUrl,
        hasAuditAddon: !!auditPriceId,
      });

      return redirect(returnUrl);
    }

    // intent === "subscribe" — go through Stripe Checkout as before
    const stripeRedirectUrl = await createStripeCheckoutSession({
      userId,
      priceId,
      domainUrl,
      customerId,
      intent,
      shelfTier,
      auditPriceId,
    });

    return redirect(stripeRedirectUrl);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => (
    <Link to="/account-details/subscription">Subscription</Link>
  ),
};

export default function SubscriptionPage() {
  const {
    title,
    subTitle,
    prices,
    tier,
    tierLimit,
    customer,
    subscriptionsWithProducts,
    openInvoices,
    paidInvoices,
    upcomingInvoices,
  } = useLoaderData<typeof loader>();
  const user = useUserData();
  const hasUnpaidInvoice = user?.hasUnpaidInvoice ?? false;

  const isCustomTier = tier === "custom" && !!tierLimit;
  const isEnterprise =
    isCustomTier && (tierLimit as unknown as CustomTierLimit)?.isEnterprise;

  const hasNoSubscription = customer?.subscriptions.data.length === 0;

  /** Check if user has a workspace plan (not just addon subscriptions) */
  const hasWorkspacePlan = subscriptionsWithProducts.some((sub) =>
    sub.items.data.some((item) => {
      const product = item.price?.product;
      if (product && typeof product === "object" && "metadata" in product) {
        const tier = product.metadata?.shelf_tier;
        return tier === "tier_1" || tier === "tier_2";
      }
      return false;
    })
  );

  /**
   * This handles the case when there is no subscription and custom tier is set.
   * This is some special cases only used for certain clients. Most users that have customTier also have a subscription
   */
  if (isCustomTier && hasNoSubscription) {
    return (
      <div className="mb-2 flex items-center gap-3 rounded border border-gray-300 p-4">
        <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
          <InfoIcon />
        </div>
        <p className="text-[14px] font-medium text-gray-700">
          You’re currently using the{" "}
          {isEnterprise ? (
            <>
              <span className="font-semibold">ENTERPRISE</span> version
            </>
          ) : (
            <>
              <span className="font-semibold">CUSTOM</span> plan
            </>
          )}{" "}
          of Shelf.
          <br />
          {isEnterprise && <>That means you have a custom plan. </>}
          To get more information about your plan, please{" "}
          <CrispButton variant="link" className="inline w-auto">
            contact support
          </CrispButton>
          .
        </p>
      </div>
    );
  }

  return (
    <>
      <div className=" flex flex-col">
        {hasUnpaidInvoice ? (
          <UnpaidInvoiceWarning invoices={openInvoices} />
        ) : null}

        {!hasWorkspacePlan ? (
          <div className="mb-8">
            {hasNoSubscription ? (
              <div className="mb-2 mt-3 flex items-center gap-3 rounded border border-gray-300 p-4">
                <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
                  <InfoIcon />
                </div>
                <p className="text-[14px] font-medium text-gray-700">
                  You're currently using the{" "}
                  <span className="font-semibold">FREE</span> version of Shelf
                </p>
              </div>
            ) : null}
            <h3 className="text-text-lg font-semibold">
              Choose your workspace plan
            </h3>
            <PricingTable prices={prices} />
          </div>
        ) : null}

        <div className="mb-8 justify-between border-b pb-5 lg:flex">
          <div className="mb-8 lg:mb-0">
            <h3 className="text-text-lg font-semibold">{title}</h3>
            <p className="text-sm text-gray-600">{subTitle}</p>
          </div>
          {!hasNoSubscription && (
            <CustomerPortalForm buttonText="Manage subscriptions" />
          )}
        </div>

        {!hasNoSubscription && (
          <>
            <SubscriptionsOverview
              customer={customer}
              subscriptions={subscriptionsWithProducts}
              prices={prices}
            />
            <InvoiceHistory
              paidInvoices={paidInvoices}
              upcomingInvoices={upcomingInvoices}
            />
          </>
        )}
      </div>
      <SuccessfulSubscriptionModal />
    </>
  );
}

type OpenInvoice = {
  number: string | null;
  subscriptionName: string;
  amountDue: number;
  currency: string;
  dueDate: number | null;
  hostedInvoiceUrl?: string | null;
};

function UnpaidInvoiceWarning({ invoices }: { invoices: OpenInvoice[] }) {
  return (
    <WarningBox className="mb-8 mt-3">
      <div>
        <h4 className="font-semibold">Unpaid invoice/s</h4>
        <p className="mt-1 text-gray-800">
          We were unable to process your latest payment. If payment is not
          resolved, your subscription will be fully canceled. Any existing
          pricing, discounts, or legacy plans tied to your subscription cannot
          be recovered after cancellation — you would need to purchase a new
          subscription at current rates.
        </p>

        {invoices.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {invoices.map((inv) => (
              <li
                key={inv.number}
                className="rounded border border-warning-200 bg-warning-50 p-3"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-gray-900">
                      {inv.subscriptionName}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      Invoice {inv.number}
                      {inv.dueDate ? (
                        <>
                          {" · "}Due{" "}
                          <DateS date={new Date(inv.dueDate * 1000)} />
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-900">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: inv.currency,
                      }).format(inv.amountDue / 100)}
                    </span>
                    {inv.hostedInvoiceUrl ? (
                      <Button
                        href={inv.hostedInvoiceUrl}
                        as="a"
                        target="_blank"
                        rel="noopener noreferrer"
                        variant="link-gray"
                      >
                        View invoice
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-2 text-gray-800">
          Please update your payment method through the{" "}
          <CustomerPortalForm
            buttonText="customer portal"
            className="inline"
            buttonProps={{
              variant: "link",
            }}
          />
          .
        </div>
      </div>
    </WarningBox>
  );
}
