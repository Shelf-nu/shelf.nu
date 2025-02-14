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
import { Button } from "~/components/shared/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { WarningBox } from "~/components/shared/warning-box";
import { CurrentPlanDetails } from "~/components/subscription/current-plan-details";
import { CustomerPortalForm } from "~/components/subscription/customer-portal-form";
import { Prices } from "~/components/subscription/prices";
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
  createStripeCustomer,
  getStripeCustomer,
  getActiveProduct,
  getCustomerActiveSubscription,
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
      getUserByID(userId),
      getUserTierLimit(userId),
    ]);

    /** Get the Stripe customer */
    const customer = user.customerId
      ? ((await getStripeCustomer(
          user.customerId
        )) as CustomerWithSubscriptions)
      : null;

    /** Get a normal subscription */
    const subscription = getCustomerActiveSubscription({ customer });

    /* Get the prices and products from Stripe */
    const prices = await getStripePricesAndProducts();

    let activeProduct = null;
    if (customer && subscription) {
      /** Get the active subscription ID */

      activeProduct = getActiveProduct({
        prices,
        priceId: subscription?.items.data[0].plan.id || null,
      });
    }

    return json(
      data({
        title: "Subscription",
        subTitle: "Pick an account plan that fits your workflow.",
        tier: user.tierId,
        tierLimit,
        prices,
        customer,
        subscription: subscription,
        activeProduct,
        usedFreeTrial: user.usedFreeTrial,
        expiration: {
          date: new Date(
            (subscription?.current_period_end as number) * 1000
          ).toLocaleDateString(),
          time: new Date(
            (subscription?.current_period_end as number) * 1000
          ).toLocaleTimeString(),
        },
        isTrialSubscription:
          !!subscription?.trial_end && subscription.status === "trialing",
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

    /**
     * We create the stripe customer on onboarding,
     * however we keep this to double check in case something went wrong
     */
    const customerId = user.customerId
      ? user.customerId
      : await createStripeCustomer({
          email,
          name: `${user.firstName} ${user.lastName}`,
          userId,
        });

    if (!customerId) {
      throw new ShelfError({
        cause: null,
        message: "No customer ID found for user",
        additionalData: { userId },
        label: "Subscription",
      });
    }

    const stripeRedirectUrl = await createStripeCheckoutSession({
      userId,
      priceId,
      domainUrl: getDomainUrl(request),
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

export default function UserPage() {
  const { title, subTitle, prices, subscription, tier, tierLimit } =
    useLoaderData<typeof loader>();
  const isLegacyPricing =
    subscription?.items?.data[0]?.price?.metadata.legacy === "true";

  const isCustomTier = tier === "custom" && !!tierLimit;
  const isEnterprise =
    isCustomTier && (tierLimit as unknown as CustomTierLimit)?.isEnterprise;

  if (isCustomTier) {
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
        <div className="mb-8 mt-3">
          <div className="mb-2 flex items-center gap-3 rounded border border-gray-300 p-4">
            <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
              <InfoIcon />
            </div>
            {!subscription ? (
              <p className="text-[14px] font-medium text-gray-700">
                You’re currently using the{" "}
                <span className="font-semibold">FREE</span> version of Shelf
              </p>
            ) : (
              <CurrentPlanDetails />
            )}
          </div>
          {isLegacyPricing && (
            <WarningBox>
              <p>
                You are on a{" "}
                <Button
                  to="https://www.shelf.nu/legacy-plan-faq"
                  target="_blank"
                  variant="link"
                >
                  legacy pricing plan
                </Button>
                . We have since updated our pricing plans. <br />
                You can view the new pricing plans in the customer portal. If
                you cancel your subscription, you will not be able to renew it.
                <br />
                For any questions - get in touch with support
              </p>
            </WarningBox>
          )}
        </div>

        <div className="mb-8 justify-between border-b pb-5 lg:flex">
          <div className="mb-8 lg:mb-0">
            <h3 className="text-text-lg font-semibold">{title}</h3>
            <p className="text-sm text-gray-600">{subTitle}</p>
          </div>
          {subscription && <CustomerPortalForm />}
        </div>

        <Tabs
          defaultValue={subscription?.items.data[0]?.plan.interval || "year"}
          className="flex w-full flex-col"
        >
          <TabsList className="center mx-auto mb-8">
            <TabsTrigger value="year">
              Yearly{" "}
              <span className="ml-2 rounded-[16px] bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700">
                Save 54%
              </span>
            </TabsTrigger>
            <TabsTrigger value="month">Monthly</TabsTrigger>
          </TabsList>
          <TabsContent value="year">
            <Prices prices={prices["year"]} />
          </TabsContent>
          <TabsContent value="month">
            <Prices prices={prices["month"]} />
          </TabsContent>
        </Tabs>
      </div>
      <SuccessfulSubscriptionModal />
    </>
  );
}
