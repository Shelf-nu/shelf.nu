import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { InfoIcon } from "~/components/icons/library";
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
import { db } from "~/database/db.server";

import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
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

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    if (!ENABLE_PREMIUM_FEATURES) {
      return redirect("/settings/account");
    }

    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.subscription,
      action: PermissionAction.read,
    });

    const user = await getUserByID(userId);

    /** Get the Stripe customer */
    const customer = user.customerId
      ? ((await getStripeCustomer(
          user.customerId
        )) as CustomerWithSubscriptions)
      : null;

    /** Get the trial subscription */
    const trialSubscription = getCustomerTrialSubscription({ customer });

    /** Get a normal subscription */
    const subscription = getCustomerActiveSubscription({ customer });

    const activeSubscription = subscription || trialSubscription;

    /* Get the prices and products from Stripe */
    const prices = await getStripePricesAndProducts();

    let activeProduct = null;
    if (customer && activeSubscription) {
      /** Get the active subscription ID */

      activeProduct = getActiveProduct({
        prices,
        priceId: activeSubscription?.items.data[0].plan.id || null,
      });
    }

    return json(
      data({
        title: "Subscription",
        subTitle: "Pick an account plan that fits your workflow.",
        prices,
        customer,
        subscription: activeSubscription,
        activeProduct,
        expiration: {
          date: new Date(
            (activeSubscription?.current_period_end as number) * 1000
          ).toLocaleDateString(),
          time: new Date(
            (activeSubscription?.current_period_end as number) * 1000
          ).toLocaleTimeString(),
        },
        isTrialSubscription: !!activeSubscription?.trial_end,
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
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.subscription,
      action: PermissionAction.update,
    });

    const { priceId } = parseData(
      await request.formData(),
      z.object({ priceId: z.string() })
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
  breadcrumb: () => <Link to="/settings/subscription">Subscription</Link>,
};

export default function UserPage() {
  const { title, subTitle, prices, subscription } =
    useLoaderData<typeof loader>();

  return (
    <>
      <div className=" flex flex-col">
        <div className="mb-8 mt-3 flex items-center gap-3 rounded border border-gray-300 p-4">
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
