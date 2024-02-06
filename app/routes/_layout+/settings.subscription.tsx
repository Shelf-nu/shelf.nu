import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import type Stripe from "stripe";
import { InfoIcon } from "~/components/icons";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { CurrentPlanDetails } from "~/components/subscription/current-plan-details";
import { CustomerPortalForm } from "~/components/subscription/customer-portal-form";
import { Prices } from "~/components/subscription/prices";
import SuccessfulSubscriptionModal from "~/components/subscription/successful-subscription-modal";
import { db } from "~/database";

import { getUserByID } from "~/modules/user";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  getDomainUrl,
  getStripePricesAndProducts,
  createStripeCheckoutSession,
  createStripeCustomer,
  getStripeCustomer,
  getActiveProduct,
  getCustomerActiveSubscription,
  getCustomerTrialSubscription,
} from "~/utils/stripe.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { authSession } = await requirePermision(
    request,
    PermissionEntity.subscription,
    PermissionAction.read
  );

  const { userId } = authSession;
  const user = await getUserByID(userId);

  if (!user) throw new Error("User not found");

  /** Get the Stripe customer */
  const customer = user.customerId
    ? ((await getStripeCustomer(user.customerId)) as CustomerWithSubscriptions)
    : null;

  let subscription = getCustomerActiveSubscription({ customer });
  /** Check if the customer has an active subscription */

  if (!subscription) {
    subscription = getCustomerTrialSubscription({ customer });
  }

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

  return json({
    title: "Subscription",
    subTitle: "Pick an account plan that fits your workflow.",
    prices,
    customer,
    subscription,
    activeProduct,
    expiration: {
      date: new Date(
        (subscription?.current_period_end as number) * 1000
      ).toLocaleDateString(),
      time: new Date(
        (subscription?.current_period_end as number) * 1000
      ).toLocaleTimeString(),
    },
    isTrialSubscription: !!subscription?.trial_end,
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { authSession } = await requirePermision(
    request,
    PermissionEntity.subscription,
    PermissionAction.update
  );

  const { userId, email } = authSession;
  const formData = await request.formData();
  const priceId = formData.get("priceId") as Stripe.Price["id"];

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { customerId: true, firstName: true, lastName: true },
  });

  if (!user) throw new Error("User not found");

  const customerId = user.customerId
    ? user.customerId
    : await createStripeCustomer({
        email,
        name: `${user.firstName} ${user.lastName}`,
        userId,
      });

  const stripeRedirectUrl = await createStripeCheckoutSession({
    userId,
    priceId,
    domainUrl: getDomainUrl(request),
    customerId: customerId,
  });
  return redirect(stripeRedirectUrl);
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.title) : "" },
];

export const handle = {
  breadcrumb: () => <Link to="/settings/subscription">Subscription</Link>,
};

export default function UserPage() {
  const { title, subTitle, prices, subscription } =
    useLoaderData<typeof loader>();

  return (
    <>
      <div className=" flex flex-col">
        <div className="mb-8 mt-3 flex items-center gap-3 rounded-lg border border-gray-300 p-4">
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

        <div className="mb-8 justify-between border-b pb-5 lg:flex">
          <div className="mb-8 lg:mb-0">
            <h3 className="text-text-lg font-semibold">{title}</h3>
            <p className="text-sm text-gray-600">{subTitle}</p>
          </div>
          {subscription && <CustomerPortalForm />}
        </div>

        <Tabs
          defaultValue={subscription?.items.data[0]?.plan.interval || "month"}
          className="flex w-full flex-col"
        >
          <TabsList className="center mx-auto mb-8">
            <TabsTrigger value="month">Monthly</TabsTrigger>
            <TabsTrigger value="year">Yearly (2 months free)</TabsTrigger>
          </TabsList>
          <TabsContent value="month">
            <Prices prices={prices["month"]} />
          </TabsContent>
          <TabsContent value="year">
            <Prices prices={prices["year"]} />
          </TabsContent>
        </Tabs>
      </div>
      <SuccessfulSubscriptionModal />
    </>
  );
}
