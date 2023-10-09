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

import { requireAuthSession } from "~/modules/auth";
import { getUserByID } from "~/modules/user";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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

export async function loader({ request }: LoaderFunctionArgs) {
  const { userId } = await requireAuthSession(request);
  const user = await getUserByID(userId);

  if (!user) throw new Error("User not found");

  /** Get the Stripe customer */
  const customer = user.customerId
    ? ((await getStripeCustomer(user.customerId)) as CustomerWithSubscriptions)
    : null;

  /** Check if the customer has an active subscription */
  const activeSubscription = getCustomerActiveSubscription({ customer });

  /* Get the prices and products from Stripe */
  const prices = await getStripePricesAndProducts();

  let activeProduct = null;
  if (customer && activeSubscription) {
    /** Get the active subscription ID */

    activeProduct = getActiveProduct({
      prices,
      priceId: activeSubscription?.items.data[0].plan.id,
    });
  }

  return json({
    title: "Subscription",
    subTitle: "Pick an account plan that fits your workflow.",
    prices,
    customer,
    activeSubscription,
    activeProduct,
    expiration: {
      date: new Date(
        (activeSubscription?.current_period_end as number) * 1000
      ).toLocaleDateString(),
      time: new Date(
        (activeSubscription?.current_period_end as number) * 1000
      ).toLocaleTimeString(),
    },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { userId, email } = await requireAuthSession(request);
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
  const { title, subTitle, prices, activeSubscription } =
    useLoaderData<typeof loader>();

  return (
    <>
      <div className=" flex flex-col">
        <div className="mb-8 mt-3 flex items-center gap-3 rounded-lg border border-gray-300 p-4">
          <div className="inline-flex items-center justify-center rounded-full border-[5px] border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
            <InfoIcon />
          </div>
          {!activeSubscription ? (
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
          {activeSubscription && <CustomerPortalForm />}
        </div>

        <Tabs
          defaultValue={
            activeSubscription?.items.data[0]?.plan.interval || "month"
          }
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
