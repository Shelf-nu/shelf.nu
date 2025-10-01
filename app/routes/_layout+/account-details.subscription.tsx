import type { CustomTierLimit } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { InfoIcon } from "~/components/icons/library";
import { CrispButton } from "~/components/marketing/crisp";

import { CustomerPortalForm } from "~/components/subscription/customer-portal-form";
import { PricingTable } from "~/components/subscription/pricing-table";
import { SubscriptionsOverview } from "~/components/subscription/subscriptions-overview";
import SuccessfulSubscriptionModal from "~/components/subscription/successful-subscription-modal";
import { db } from "~/database/db.server";
import { getUserTierLimit } from "~/modules/tier/service.server";

import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";

import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  getDomainUrl,
  getStripePricesAndProducts,
  createStripeCheckoutSession,
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
        },
      }),
      getUserTierLimit(userId),
    ]);

    /** Get the Stripe customer */
    const customer = (await getStripeCustomer(
      await getOrCreateCustomerId(user)
    )) as CustomerWithSubscriptions;

    /* Get the prices and products from Stripe */
    const prices = await getStripePricesAndProducts();

    return json(
      data({
        title: `Subscriptions`,
        subTitle:
          customer?.subscriptions.total_count === 0
            ? "Pick an account plan that fits your workflow."
            : "Manage your account plan.",
        tier: user.tierId,
        tierLimit,
        prices,
        customer,
        usedFreeTrial: user.usedFreeTrial,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId, email } = authSession;

  try {
    const { priceId, intent, shelfTier } = parseData(
      await request.formData(),
      z.object({
        priceId: z.string(),
        intent: z.enum(["trial", "subscribe"]),
        shelfTier: z.enum(["tier_1", "tier_2"]),
      })
    );

    const user = await db.user
      .findUniqueOrThrow({
        where: { id: userId },
        select: { customerId: true, firstName: true, lastName: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "No user found",
          additionalData: { userId },
          label: "Subscription",
        });
      });

    const customerId = await getOrCreateCustomerId({
      id: userId,
      email,
      ...user,
    });
    const domainUrl = getDomainUrl(request);

    const stripeRedirectUrl = await createStripeCheckoutSession({
      userId,
      priceId,
      domainUrl,
      customerId: customerId,
      intent,
      shelfTier,
    });

    return redirect(stripeRedirectUrl);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
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
  const { title, subTitle, prices, tier, tierLimit, customer } =
    useLoaderData<typeof loader>();

  const isCustomTier = tier === "custom" && !!tierLimit;
  const isEnterprise =
    isCustomTier && (tierLimit as unknown as CustomTierLimit)?.isEnterprise;

  const hasNoSubscription = customer?.subscriptions.total_count === 0;

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
        {hasNoSubscription ? (
          <div className="mb-8 mt-3">
            <div className="mb-2 flex items-center gap-3 rounded border border-gray-300 p-4">
              <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
                <InfoIcon />
              </div>
              <p className="text-[14px] font-medium text-gray-700">
                You’re currently using the{" "}
                <span className="font-semibold">FREE</span> version of Shelf
              </p>
            </div>
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
        {/* */}
        {hasNoSubscription ? (
          <PricingTable prices={prices} />
        ) : (
          <SubscriptionsOverview customer={customer} prices={prices} />
        )}
      </div>
      <SuccessfulSubscriptionModal />
    </>
  );
}
