import { useMemo, useState } from "react";
import type { Currency, Prisma } from "@prisma/client";
import { data, type LoaderFunctionArgs, type MetaFunction } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { Form } from "~/components/custom-form";
import { ShelfSymbolLogo } from "~/components/marketing/logos";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { GrayBadge } from "~/components/shared/gray-badge";
import { Tag } from "~/components/shared/tag";
import { config } from "~/config/shelf.config";
import { useSearchParams } from "~/hooks/search-params";
import { getAuditAddonPrices } from "~/modules/audit/addon.server";
import { getUserByID } from "~/modules/user/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { formatCurrency } from "~/utils/currency";
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
    const [prices, auditPrices] = await Promise.all([
      getStripePricesForTrialPlanSelection(),
      getAuditAddonPrices(),
    ]);

    return data(
      payload({
        title: "Subscription",
        subTitle: "Pick an account plan that fits your workflow.",
        /** Filter out the montly and yearly prices to only have prices for team plan */
        prices,
        customer,
        auditPrices,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function SelectPlan() {
  const { prices, auditPrices } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
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

  // Initialize audit toggle from URL param (passed from welcome page)
  const [wantsAudits, setWantsAudits] = useState(
    () => searchParams.get("withAudits") === "true"
  );

  const navigation = useNavigation();
  const activePrice = selectedPlan ? planPrices[selectedPlan] : null;
  const disabled = isFormProcessing(navigation.state) || !activePrice;

  const hasAuditPrices = !!(auditPrices.month || auditPrices.year);

  // Get the matching audit price for the selected billing interval
  const activeAuditPrice =
    selectedPlan && auditPrices[selectedPlan]
      ? auditPrices[selectedPlan]
      : auditPrices.year || auditPrices.month;

  const fmtPrice = (amountInCents: number, currency: string) =>
    formatCurrency({
      value: amountInCents / 100,
      currency: currency as Currency,
      locale: "en-US",
    });

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

    const formattedPrice = amount > 0 ? fmtPrice(amount, price.currency) : "$0";

    let footnote = "";
    if (interval === "year") {
      footnote = `Billed annually ${fmtPrice(
        amount / 10,
        price.currency
      )} per workspace`;
    } else if (interval === "month") {
      footnote = "Billed monthly per workspace";
    }

    return {
      label: interval === "year" ? "Annual" : "Monthly",
      price: `${formattedPrice}/mo`,
      footnote,
    };
  };

  const staticAddOns = [
    {
      title: "Alternative Barcodes",
      badge: "$14/mo or $170/yr",
      description:
        "Keep your existing labels. Supports Code128, Code39, EAN-13, DataMatrix & QR codes — ideal for migrations.",
      footnote: "Enable any time by contacting our team.",
    },
  ];

  // Build cost summary
  const teamPriceAmount = activePrice?.unit_amount || 0;
  const teamPriceCurrency = activePrice?.currency || "usd";
  const auditPriceAmount =
    wantsAudits && activeAuditPrice ? activeAuditPrice.unit_amount || 0 : 0;
  const totalAmount = teamPriceAmount + auditPriceAmount;
  const isYearly = selectedPlan === "year";

  const fmtPerMonth = (cents: number, currency: string) =>
    fmtPrice(isYearly ? Math.round(cents / 12) : cents, currency);

  const billingLabel = isYearly ? "yr" : "mo";

  const trialText = wantsAudits
    ? `You won't be charged during the trial. After ${config.freeTrialDays} days, continue on Team + Audits or change plans.`
    : `You won't be charged during the trial. After ${config.freeTrialDays} days, continue on Team or change plans.`;

  return (
    <div className="flex flex-col items-center p-4 sm:p-6">
      <ShelfSymbolLogo className="my-4 size-8 md:mt-0" />
      <div className="mb-8 text-center">
        <h3 className="text-2xl font-semibold text-color-900">
          Select your payment plan
        </h3>
        <p className="mt-3 text-base text-color-600">
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
                      : "border-color-200 bg-surface hover:border-color-300"
                  )}
                >
                  {interval === "year" ? (
                    <Tag
                      className={tw(
                        "w-max",
                        " absolute right-2 top-2 bg-color-100 text-color-700"
                      )}
                    >
                      Save 54%
                    </Tag>
                  ) : null}
                  <span className="text-sm font-semibold text-primary-700">
                    {display.label}
                  </span>
                  <span className="text-2xl font-semibold text-color-900">
                    {display.price}
                  </span>
                  <span className="text-sm text-color-600">
                    {display.footnote}
                  </span>
                </div>
              </label>
            );
          })}
        </fieldset>

        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-color-900">
              Optional add-ons
            </h3>
            <p className="mt-1 text-sm text-color-600">
              Advanced capabilities for migrations & IT environments.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Interactive Audit add-on card */}
            {hasAuditPrices ? (
              <article className="h-full">
                <Card
                  className={tw(
                    "flex h-full cursor-pointer flex-col gap-3 p-0",
                    "transition-shadow",
                    wantsAudits ? "" : "hover:border-color-300"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setWantsAudits((prev) => !prev)}
                    className={tw(
                      "flex size-full flex-col gap-3 rounded border border-transparent p-4 text-left",
                      wantsAudits
                        ? "border-primary-400 bg-primary-50"
                        : "border-transparent"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={tw(
                          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2",
                          wantsAudits
                            ? "bg-primary-500 border-primary-500"
                            : "border-color-300 bg-surface"
                        )}
                        aria-hidden="true"
                      >
                        {wantsAudits ? (
                          <svg
                            className="size-3 text-white"
                            viewBox="0 0 12 12"
                            fill="none"
                          >
                            <path
                              d="M10 3L4.5 8.5L2 6"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : null}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-base font-semibold text-color-900">
                            Audits
                          </h4>
                          <Tag className="bg-primary-50 text-primary-700">
                            7-day trial
                          </Tag>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-color-600">
                      Create audits, assign auditors, scan QR codes, and track
                      asset verification in real-time.
                    </p>
                    {activeAuditPrice ? (
                      <div className="mt-1">
                        <span className="text-lg font-semibold text-color-900">
                          {fmtPerMonth(
                            activeAuditPrice.unit_amount || 0,
                            activeAuditPrice.currency
                          )}
                          /mo
                        </span>
                        <p className="text-xs text-color-500">
                          Billed{" "}
                          {isYearly
                            ? `annually ${fmtPrice(
                                activeAuditPrice.unit_amount || 0,
                                activeAuditPrice.currency
                              )}`
                            : "monthly"}{" "}
                          per workspace
                        </p>
                      </div>
                    ) : null}
                  </button>
                </Card>
              </article>
            ) : null}

            {/* Static add-on cards */}
            {staticAddOns.map((addOn) => (
              <article key={addOn.title} className="h-full">
                <Card className="flex h-full flex-col gap-3">
                  <div>
                    <h4 className="text-base font-semibold text-color-900">
                      {addOn.title}
                    </h4>
                    <div className="mt-1">
                      <GrayBadge className="whitespace-nowrap">
                        {addOn.badge}
                      </GrayBadge>
                    </div>
                  </div>
                  <p className="text-sm text-color-600">{addOn.description}</p>
                  <p className="text-xs text-color-500">{addOn.footnote}</p>
                </Card>
              </article>
            ))}
          </div>
        </section>

        {/* SSO — separate category, full width */}
        <section className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-color-900">
              Enterprise integrations
            </h3>
          </div>
          <Card className="flex flex-col gap-3">
            <div>
              <h4 className="text-base font-semibold text-color-900">
                SSO Integration (Team only)
              </h4>
              <div className="mt-1">
                <GrayBadge className="whitespace-nowrap">Paid add-on</GrayBadge>
              </div>
            </div>
            <p className="text-sm text-color-600">
              Single sign-on for your organization; centralized identity &
              access.
            </p>
            <p className="text-xs text-color-500">
              Available for Team workspaces. Pricing provided during evaluation.
            </p>
          </Card>
        </section>

        {/* Cost summary */}
        {activePrice && (
          <section className="rounded-xl border border-color-200 bg-color-50 p-5">
            <h3 className="mb-3 text-sm font-semibold text-color-700">
              Cost summary{" "}
              <span className="font-normal text-color-600">
                (applied after free trial ends)
              </span>
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-color-600">
                  Team ({isYearly ? "yearly" : "monthly"})
                </span>
                <span className="font-medium text-color-900">
                  {fmtPrice(teamPriceAmount, teamPriceCurrency)}/{billingLabel}
                </span>
              </div>
              {wantsAudits && activeAuditPrice ? (
                <div className="flex items-center justify-between">
                  <span className="text-color-600">
                    Audits ({isYearly ? "yearly" : "monthly"})
                  </span>
                  <span className="font-medium text-color-900">
                    {fmtPrice(auditPriceAmount, activeAuditPrice.currency)}/
                    {billingLabel}
                  </span>
                </div>
              ) : null}
              <div className="border-t border-color-200 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-color-900">Total</span>
                  <span className="font-semibold text-color-900">
                    {fmtPrice(totalAmount, teamPriceCurrency)}/{billingLabel}
                  </span>
                </div>
                {isYearly && (
                  <p className="mt-1 text-right text-xs text-color-500">
                    {fmtPrice(Math.round(totalAmount / 12), teamPriceCurrency)}
                    /mo effective rate
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        <p className="text-center text-sm text-color-600">{trialText}</p>

        <input type="hidden" name="priceId" value={activePrice?.id ?? ""} />
        <input
          type="hidden"
          name="shelfTier"
          value={activePrice?.product.metadata.shelf_tier}
        />
        {wantsAudits && activeAuditPrice ? (
          <input
            type="hidden"
            name="auditPriceId"
            value={activeAuditPrice.id}
          />
        ) : null}

        <Button
          width="full"
          type="submit"
          name="intent"
          value="trial"
          variant="accent"
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
