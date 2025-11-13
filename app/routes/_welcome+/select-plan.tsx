import { useMemo, useState } from "react";
import type { Prisma } from "@prisma/client";
import { data, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { Form } from "~/components/custom-form";
import { ShelfSymbolLogo } from "~/components/marketing/logos";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Tag } from "~/components/shared/tag";
import { config } from "~/config/shelf.config";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import type { CustomerWithSubscriptions } from "~/utils/stripe.server";
import {
  getStripeCustomer,
  getStripePricesForTrialPlanSelection,
} from "~/utils/stripe.server";
import { tw } from "~/utils/tw";

export const meta: MetaFunction = () => [
  { title: appendToMetaTitle("Welcome to shelf.nu") },
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.subscription,
      action: PermissionAction.read,
    });

    const user = await getUserByID(userId, {
      select: { id: true, customerId: true } satisfies Prisma.UserSelect,
    });

    /** Get the Stripe customer */
    const customer = user.customerId
      ? ((await getStripeCustomer(
          user.customerId
        )) as CustomerWithSubscriptions)
      : null;

    /* Get the prices and products from Stripe */
    const prices = await getStripePricesForTrialPlanSelection();

    return payload({
      title: "Subscription",
      subTitle: "Pick an account plan that fits your workflow.",
      /** Filter out the montly and yearly prices to only have prices for team plan */
      prices,
      customer,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function SelectPlan() {
  const { prices } = useLoaderData<typeof loader>();
  type BillingInterval = "month" | "year";

  const planPrices = useMemo(() => {
    const intervals: Partial<Record<BillingInterval, (typeof prices)[number]>> =
      {};
    prices.forEach((price) => {
      const interval = price.recurring?.interval;
      if (interval === "month" || interval === "year") {
        intervals[interval] = price;
      }
    });
    return intervals;
  }, [prices]);

  const [selectedPlan, setSelectedPlan] = useState<BillingInterval | null>(
    () => (planPrices.month ? "month" : planPrices.year ? "year" : null)
  );

  const navigation = useNavigation();
  const activePrice = selectedPlan ? planPrices[selectedPlan] : null;
  const disabled = isFormProcessing(navigation.state) || !activePrice;

  // Generate dynamic plan copy from Stripe prices
  const getPlanCopy = (
    price: (typeof prices)[number]
  ): { label: string; price: string; footnote: string } => {
    const interval = price.recurring?.interval;
    const amount =
      price.unit_amount != null
        ? interval === "year"
          ? price.unit_amount / 10
          : price.unit_amount
        : 0;

    const formattedPrice =
      amount > 0
        ? (amount / 100).toLocaleString("en-US", {
            style: "currency",
            currency: price.currency,
            maximumFractionDigits: 0,
          })
        : "$0";

    let footnote = "";
    if (interval === "year") {
      const annualTotal = (amount / 10).toLocaleString("en-US", {
        style: "currency",
        currency: price.currency,
        maximumFractionDigits: 0,
      });
      footnote = `Billed annually ${annualTotal} per workspace`;
    } else if (interval === "month") {
      footnote = "Billed monthly per workspace";
    }

    return {
      label: interval === "year" ? "Annual" : "Monthly",
      price: `${formattedPrice}/mo`,
      footnote,
    };
  };

  const addOns = [
    {
      title: "Alternative Barcodes",
      badge: "$14/mo or $170/yr",
      description:
        "Keep your existing labels. Supports Code128, Code39, EAN-13, DataMatrix & QR codes — ideal for migrations.",
      footnote: "Enable any time by contacting our team.",
    },
    {
      title: "SSO Integration (Team only)",
      badge: "Paid add-on",
      description:
        "Single sign-on for your organization; centralized identity & access.",
      footnote:
        "Available for Team workspaces. Pricing provided during evaluation.",
    },
  ];

  return (
    <div className="flex flex-col items-center p-4 sm:p-6">
      <ShelfSymbolLogo className="my-4 size-8 md:mt-0" />
      <div className="mb-8 text-center">
        <h3 className="text-2xl font-semibold text-gray-900">
          Select your payment plan
        </h3>
        <p className="mt-3 text-base text-gray-600">
          No credit card or payment required to start your 7-day trial.{" "}
        </p>
      </div>

      <Form
        method="post"
        className="w-full max-w-3xl space-y-8"
        action="/account-details/subscription"
      >
        <fieldset
          className="flex items-center justify-between gap-2"
          aria-label="Billing interval"
        >
          <legend className="sr-only">Choose billing interval</legend>
          {(Object.keys(planPrices) as BillingInterval[]).map((interval) => {
            const price = planPrices[interval];
            if (!price) return null;
            const display = getPlanCopy(price);
            const id = `billing-${interval}`;
            const isSelected = selectedPlan === interval;
            return (
              <label
                key={interval}
                htmlFor={id}
                className="flex-1 cursor-pointer"
              >
                <input
                  id={id}
                  type="radio"
                  name="billingInterval"
                  value={interval}
                  checked={isSelected}
                  onChange={() => setSelectedPlan(interval)}
                  className="sr-only"
                />
                <div
                  className={tw(
                    "relative flex flex-col gap-2 rounded border px-6 py-5 transition",
                    isSelected
                      ? "border-primary-400 bg-primary-50"
                      : "border-gray-200 bg-white hover:border-gray-300"
                  )}
                >
                  {interval === "year" ? (
                    <Tag
                      className={tw(
                        "w-max",
                        " absolute right-2 top-2 bg-orange-100 text-orange-700"
                      )}
                    >
                      Save 54%
                    </Tag>
                  ) : null}
                  <span className="text-sm font-semibold text-primary-700">
                    {display.label}
                  </span>
                  <span className="text-2xl font-semibold text-gray-900">
                    {display.price}
                  </span>
                  <span className="text-sm text-gray-600">
                    {display.footnote}
                  </span>
                </div>
              </label>
            );
          })}
        </fieldset>

        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Optional add-ons
            </h3>
            <p className="mt-1 text-sm text-gray-600">
              Advanced capabilities for migrations & IT environments.{" "}
              <strong>Enable any time by contacting our team.</strong>
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {addOns.map((addOn) => (
              <article key={addOn.title} className="h-full">
                <Card className="flex h-full flex-col gap-3">
                  <div className="">
                    <h4 className="text-base font-semibold text-gray-900">
                      {addOn.title}
                    </h4>
                    <div className="mt-1">
                      <GrayBadge className="whitespace-nowrap">
                        {addOn.badge}
                      </GrayBadge>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600">{addOn.description}</p>
                  <p className="text-xs text-gray-500">{addOn.footnote}</p>
                </Card>
              </article>
            ))}
          </div>
        </section>

        <p className="text-center text-sm text-gray-600">
          You won’t be charged during the trial. After {config.freeTrialDays}{" "}
          days, continue on Team or change plans.
        </p>

        <input type="hidden" name="priceId" value={activePrice?.id ?? ""} />
        <input
          type="hidden"
          name="shelfTier"
          value={activePrice?.product.metadata.shelf_tier}
        />

        <Button
          width="full"
          type="submit"
          name="intent"
          value="trial"
          disabled={disabled}
          data-analytics="cta-start-trial"
        >
          Start {config.freeTrialDays}-day free trial
        </Button>
      </Form>

      <Button variant="link" to="/welcome" className="mt-4">
        Back
      </Button>
    </div>
  );
}
