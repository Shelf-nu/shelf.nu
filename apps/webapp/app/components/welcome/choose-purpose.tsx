import { useState } from "react";
import type { Currency } from "@prisma/client";
import { CheckIcon } from "lucide-react";
import { useNavigation } from "react-router";
import { Form } from "~/components/custom-form";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { config } from "~/config/shelf.config";
import { formatCurrency } from "~/utils/currency";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { ShelfSymbolLogo } from "../marketing/logos";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { GrayBadge } from "../shared/gray-badge";
import { Tag } from "../shared/tag";

type SignupPlan = "personal" | "team";
type AuditBillingInterval = "month" | "year";

const fmtPrice = (amountInCents: number, currency: string) =>
  formatCurrency({
    value: amountInCents / 100,
    currency: currency as Currency,
    locale: "en-US",
  });

type AuditPrices = {
  month: PriceWithProduct | null;
  year: PriceWithProduct | null;
};

const PLAN_DETAILS: Record<
  SignupPlan,
  {
    title: string;
    description: string;
    chip: string;
    helper?: string;
    badge?: string;
    analytics: string;
    ctaLabel: string;
    href: string;
  }
> = {
  personal: {
    title: "Personal",
    description:
      "For testing or individual use. Includes 3 custom fields and branded QR labels.",
    chip: "Free",
    helper: "Personal workspaces are free and ready to use immediately.",
    analytics: "cta-start-personal",
    ctaLabel: "Start using Shelf",
    href: "/assets",
  },
  team: {
    title: "Team",
    description: `For organizations and labs. Includes collaboration features with a ${config.freeTrialDays}-day free trial. No credit card required.`,
    chip: `${config.freeTrialDays}-day trial`,
    badge: "Recommended",
    analytics: "cta-next-team",
    ctaLabel: "Next: Select a plan",
    href: "/select-plan",
  },
};

export function ChoosePurpose({
  auditPrices,
  usedAuditTrial,
}: {
  auditPrices: AuditPrices;
  usedAuditTrial: boolean;
}) {
  const [selectedPlan, setSelectedPlan] = useState<SignupPlan | null>(null);
  const [wantsAudits, setWantsAudits] = useState(false);
  const [auditBillingInterval, setAuditBillingInterval] =
    useState<AuditBillingInterval>("year");
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state) || !selectedPlan;

  const selectedDetails = selectedPlan ? PLAN_DETAILS[selectedPlan] : null;

  const hasAuditPrices = !!(auditPrices.month || auditPrices.year);
  const showAuditOption =
    hasAuditPrices && !usedAuditTrial && selectedPlan !== null;

  // Get the selected audit price based on billing interval
  const selectedAuditPrice =
    auditPrices[auditBillingInterval] || auditPrices.year || auditPrices.month;

  // Determine CTA label based on plan and audit selection
  const ctaLabel =
    selectedPlan === "personal" && wantsAudits
      ? "Start with Audit trial"
      : selectedDetails?.ctaLabel ?? "Start using Shelf";

  // Determine href for team flow (pass withAudits param)
  const teamHref = wantsAudits
    ? "/select-plan?withAudits=true"
    : "/select-plan";

  // For personal + audits, we use a Form POST.
  // For personal (no audits) or team, we use a Link.
  const isPersonalWithAudits = selectedPlan === "personal" && wantsAudits;

  const ctaHref =
    selectedPlan === "team" ? teamHref : selectedDetails?.href ?? "/assets";

  return (
    <>
      <div className="flex flex-col items-center p-4 sm:p-6">
        <ShelfSymbolLogo className="mb-4 size-8" />
        <div className="mb-4 max-w-2xl text-center">
          <h3 className="text-2xl font-semibold text-color-900">
            How would you like to get started with Shelf?
          </h3>
          <p className="mt-3 text-base text-color-600">
            Your choice determines which features we prepare for you. You can
            always switch later.
          </p>
          <p className="mt-4 rounded-lg bg-color-50 px-4 py-3 text-sm text-color-600">
            If your organization already uses Shelf, you don't need to create a
            new workspace — look for your email invite or sign in instead.
          </p>
        </div>
        <h4 className=" w-full text-left  font-semibold text-color-700">
          Select a plan
        </h4>
        <div className="flex w-full gap-4">
          {(Object.keys(PLAN_DETAILS) as Array<SignupPlan>).map((planKey) => {
            const plan = PLAN_DETAILS[planKey];
            const isSelected = selectedPlan === planKey;
            return (
              <div key={planKey} className="h-full flex-1">
                <PlanCard
                  planKey={planKey}
                  onSelect={(key) => {
                    setSelectedPlan(key);
                    // Reset audit toggle when switching plans
                    setWantsAudits(false);
                  }}
                  selected={isSelected}
                  description={plan.description}
                  title={plan.title}
                  chipLabel={plan.chip}
                  badgeLabel={plan.badge}
                />
                {plan.helper ? (
                  <p className="text-sm text-color-500">{plan.helper}</p>
                ) : null}
              </div>
            );
          })}
        </div>

        {showAuditOption ? (
          <>
            <h4 className="mt-6 w-full text-left font-semibold text-color-700">
              Choose optional add-ons
            </h4>
            <AuditAddonToggle
              wantsAudits={wantsAudits}
              onToggle={() => setWantsAudits((prev) => !prev)}
              auditPrices={auditPrices}
              billingInterval={auditBillingInterval}
              onBillingIntervalChange={setAuditBillingInterval}
              showBillingToggle={selectedPlan === "personal"}
            />
          </>
        ) : null}

        {isPersonalWithAudits ? (
          <Form method="POST" className="mt-8 w-full">
            <input type="hidden" name="intent" value="personal-with-audits" />
            <input
              type="hidden"
              name="auditPriceId"
              value={selectedAuditPrice?.id ?? ""}
            />
            <Button
              width="full"
              type="submit"
              variant="accent"
              disabled={disabled}
              data-analytics="cta-start-personal-with-audits"
            >
              {ctaLabel}
            </Button>
          </Form>
        ) : (
          <Button
            to={ctaHref}
            width="full"
            variant="accent"
            className="mt-8"
            disabled={disabled}
            data-analytics={selectedDetails?.analytics}
          >
            {ctaLabel}
          </Button>
        )}
      </div>
    </>
  );
}

function AuditAddonToggle({
  wantsAudits,
  onToggle,
  auditPrices,
  billingInterval,
  onBillingIntervalChange,
  showBillingToggle,
}: {
  wantsAudits: boolean;
  onToggle: () => void;
  auditPrices: AuditPrices;
  billingInterval: AuditBillingInterval;
  onBillingIntervalChange: (interval: AuditBillingInterval) => void;
  showBillingToggle: boolean;
}) {
  return (
    <div className="mt-2 w-full">
      <Card
        className={tw(
          "p-0",
          "transition-shadow",
          wantsAudits ? "" : "hover:border-color-300"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className={tw(
            "relative flex w-full items-start gap-3 rounded border border-transparent p-4 text-left",
            wantsAudits
              ? "border-primary-400 bg-primary-50"
              : "border-transparent"
          )}
        >
          <div
            className={tw(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2",
              wantsAudits
                ? "bg-primary-500 border-primary-500"
                : "border-color-300 bg-surface"
            )}
            aria-hidden="true"
          >
            {wantsAudits ? <CheckIcon className="size-3 text-white" /> : null}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-semibold text-color-900">Audits</h4>
              <Tag className="bg-primary-50 text-primary-700">7-day trial</Tag>
            </div>
            <p className="mt-1 text-sm text-color-600">
              Create audits, assign auditors, scan QR codes, and track asset
              verification in real-time.
            </p>
          </div>
        </button>
      </Card>

      {/* Billing interval cards — shown when audits selected on personal plan */}
      {wantsAudits && showBillingToggle ? (
        <AuditBillingCards
          auditPrices={auditPrices}
          billingInterval={billingInterval}
          onBillingIntervalChange={onBillingIntervalChange}
        />
      ) : null}
    </div>
  );
}

function AuditBillingCards({
  auditPrices,
  billingInterval,
  onBillingIntervalChange,
}: {
  auditPrices: AuditPrices;
  billingInterval: AuditBillingInterval;
  onBillingIntervalChange: (interval: AuditBillingInterval) => void;
}) {
  const { month: monthlyPrice, year: yearlyPrice } = auditPrices;

  const yearlyDiscount =
    monthlyPrice && yearlyPrice
      ? Math.round(
          (1 -
            (yearlyPrice.unit_amount || 0) /
              12 /
              (monthlyPrice.unit_amount || 1)) *
            100
        )
      : null;

  return (
    <div className="mt-4 flex flex-wrap items-stretch gap-4">
      {monthlyPrice && (
        <button
          type="button"
          onClick={() => onBillingIntervalChange("month")}
          className={tw(
            "flex flex-1 cursor-pointer flex-col items-center rounded-lg p-4 text-center transition-colors",
            billingInterval === "month"
              ? "bg-primary-25 border-2 border-primary-200"
              : "border border-color-200"
          )}
        >
          <p
            className={tw(
              "mb-1 text-sm font-medium",
              billingInterval === "month"
                ? "text-primary-600"
                : "text-color-500"
            )}
          >
            Monthly
          </p>
          <p className="text-2xl font-semibold">
            {fmtPrice(monthlyPrice.unit_amount || 0, monthlyPrice.currency)}
            <span className="text-sm font-normal text-color-500">/mo</span>
          </p>
          <p className="text-xs text-color-500">Billed monthly</p>
          <p className="mt-1 text-xs text-color-500">per workspace</p>
        </button>
      )}
      {yearlyPrice && (
        <button
          type="button"
          onClick={() => onBillingIntervalChange("year")}
          className={tw(
            "relative flex flex-1 cursor-pointer flex-col items-center rounded-lg p-4 text-center transition-colors",
            billingInterval === "year"
              ? "bg-primary-25 border-2 border-primary-200"
              : "border border-color-200"
          )}
        >
          {yearlyDiscount != null && yearlyDiscount > 0 && (
            <span className="bg-primary-500 absolute -top-2.5 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white">
              Save {yearlyDiscount}%
            </span>
          )}
          <p
            className={tw(
              "mb-1 text-sm font-medium",
              billingInterval === "year" ? "text-primary-600" : "text-color-500"
            )}
          >
            Yearly
          </p>
          <p className="text-2xl font-semibold">
            {fmtPrice(
              Math.round((yearlyPrice.unit_amount || 0) / 12),
              yearlyPrice.currency
            )}
            <span className="text-sm font-normal text-color-500">/mo</span>
          </p>
          <p className="text-xs text-color-500">
            Billed annually{" "}
            {fmtPrice(yearlyPrice.unit_amount || 0, yearlyPrice.currency)}
          </p>
          <p className="mt-1 text-xs text-color-500">per workspace</p>
        </button>
      )}
    </div>
  );
}

function PlanCard({
  planKey,
  selected,
  onSelect,
  title,
  description,
  chipLabel,
  badgeLabel,
}: {
  planKey: SignupPlan;
  selected: boolean;
  onSelect: (plan: SignupPlan) => void;
  title: string;
  description: string;
  chipLabel: string;
  badgeLabel?: string;
}) {
  return (
    <Card
      className={tw(
        "p-0",
        "transition-shadow",
        selected ? "" : "hover:border-color-300"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(planKey)}
        className={tw(
          " relative w-full rounded border border-transparent bg-surface px-4 py-5 text-left",
          selected ? "border-primary-400 bg-primary-50" : "border-transparent"
        )}
      >
        <div className="absolute right-1.5 top-1.5">
          {badgeLabel ? (
            <Tag className={tw("w-max", " bg-color-100 text-color-700")}>
              {badgeLabel}
            </Tag>
          ) : null}
        </div>
        <div>
          <h4 className="text-lg font-semibold text-color-900">{title}</h4>
          <p className="mt-2 text-sm text-color-600">{description}</p>
          <GrayBadge className="mt-4">{chipLabel}</GrayBadge>
        </div>
      </button>
    </Card>
  );
}
