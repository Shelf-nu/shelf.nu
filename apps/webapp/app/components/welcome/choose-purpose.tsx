import type React from "react";
import { useState } from "react";
import type { Currency } from "@prisma/client";
import { CheckIcon, UserIcon, UsersIcon } from "lucide-react";
import { useNavigation } from "react-router";
import { Form } from "~/components/custom-form";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { AUDIT_ADDON, BARCODE_ADDON } from "~/config/addon-copy";
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

type AddonPrices = {
  month: PriceWithProduct | null;
  year: PriceWithProduct | null;
};

const PLAN_ICONS: Record<SignupPlan, React.ReactNode> = {
  personal: (
    <div className="flex size-10 items-center justify-center rounded-lg bg-gray-100">
      <UserIcon className="size-5 text-gray-600" />
    </div>
  ),
  team: (
    <div className="flex size-10 items-center justify-center rounded-lg bg-primary-50">
      <UsersIcon className="size-5 text-primary-600" />
    </div>
  ),
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
  barcodePrices,
  usedAuditTrial,
  usedBarcodeTrial,
}: {
  auditPrices: AddonPrices;
  barcodePrices: AddonPrices;
  usedAuditTrial: boolean;
  usedBarcodeTrial: boolean;
}) {
  const [selectedPlan, setSelectedPlan] = useState<SignupPlan | null>(null);
  const [wantsAudits, setWantsAudits] = useState(false);
  const [wantsBarcodes, setWantsBarcodes] = useState(false);
  const [auditBillingInterval, setAuditBillingInterval] =
    useState<AuditBillingInterval>("year");
  const [barcodeBillingInterval, setBarcodeBillingInterval] =
    useState<AuditBillingInterval>("year");
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state) || !selectedPlan;

  const selectedDetails = selectedPlan ? PLAN_DETAILS[selectedPlan] : null;

  const hasAuditPrices = !!(auditPrices.month || auditPrices.year);
  const hasBarcodePrices = !!(barcodePrices.month || barcodePrices.year);
  const showAuditOption =
    hasAuditPrices && !usedAuditTrial && selectedPlan !== null;
  const showBarcodeOption =
    hasBarcodePrices && !usedBarcodeTrial && selectedPlan !== null;
  const showAddonsSection = showAuditOption || showBarcodeOption;

  // Get the selected addon prices based on billing interval
  const selectedAuditPrice =
    auditPrices[auditBillingInterval] || auditPrices.year || auditPrices.month;
  const selectedBarcodePrice =
    barcodePrices[barcodeBillingInterval] ||
    barcodePrices.year ||
    barcodePrices.month;

  const wantsAnyAddon = wantsAudits || wantsBarcodes;

  // Determine CTA label based on plan and addon selection
  const selectedAddons = [
    wantsAudits && "Audit",
    wantsBarcodes && "Barcode",
  ].filter(Boolean);
  const ctaLabel =
    selectedPlan === "personal" && wantsAnyAddon
      ? `Start with ${selectedAddons.join(" & ")} trial`
      : selectedDetails?.ctaLabel ?? "Start using Shelf";

  // Determine href for team flow (pass addon params)
  const teamParams = new URLSearchParams();
  if (wantsAudits) teamParams.set("withAudits", "true");
  if (wantsBarcodes) teamParams.set("withBarcodes", "true");
  const teamHref = teamParams.toString()
    ? `/select-plan?${teamParams.toString()}`
    : "/select-plan";

  // For personal + addons, we use a Form POST.
  // For personal (no addons) or team, we use a Link.
  const isPersonalWithAddons = selectedPlan === "personal" && wantsAnyAddon;

  const ctaHref =
    selectedPlan === "team" ? teamHref : selectedDetails?.href ?? "/assets";

  return (
    <>
      <div className="flex flex-col items-center p-4 sm:p-6">
        <ShelfSymbolLogo className="mb-4 size-8" />
        <div className="mb-4 max-w-2xl text-center">
          <h3 className="text-2xl font-semibold text-gray-900">
            How would you like to get started with Shelf?
          </h3>
          <p className="mt-3 text-base text-gray-600">
            Your choice determines which features we prepare for you. You can
            always switch later.
          </p>
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
            If your organization already uses Shelf, you don't need to create a
            new workspace — look for your email invite or sign in instead.
          </p>
        </div>
        <h4 className=" w-full text-left  font-semibold text-gray-700">
          Select a plan
        </h4>
        <div className="grid w-full grid-cols-2 gap-4">
          {(Object.keys(PLAN_DETAILS) as Array<SignupPlan>).map((planKey) => {
            const plan = PLAN_DETAILS[planKey];
            const isSelected = selectedPlan === planKey;
            return (
              <PlanCard
                key={planKey}
                planKey={planKey}
                onSelect={(key) => {
                  setSelectedPlan(key);
                  // Reset addon toggles when switching plans
                  setWantsAudits(false);
                  setWantsBarcodes(false);
                }}
                selected={isSelected}
                description={plan.description}
                title={plan.title}
                chipLabel={plan.chip}
                badgeLabel={plan.badge}
                icon={PLAN_ICONS[planKey]}
              />
            );
          })}
        </div>
        {PLAN_DETAILS.personal.helper ? (
          <p className="mt-1 w-full text-sm text-gray-500">
            {PLAN_DETAILS.personal.helper}
          </p>
        ) : null}

        {showAddonsSection ? (
          <>
            <h4 className="mt-6 w-full text-left font-semibold text-gray-700">
              Choose optional add-ons
            </h4>
            {showAuditOption ? (
              <AddonToggle
                label={AUDIT_ADDON.label}
                description={AUDIT_ADDON.description}
                selected={wantsAudits}
                onToggle={() => setWantsAudits((prev) => !prev)}
                prices={auditPrices}
                billingInterval={auditBillingInterval}
                onBillingIntervalChange={setAuditBillingInterval}
                showBillingToggle={selectedPlan === "personal"}
              />
            ) : null}
            {showBarcodeOption ? (
              <AddonToggle
                label={BARCODE_ADDON.label}
                description={BARCODE_ADDON.description}
                selected={wantsBarcodes}
                onToggle={() => setWantsBarcodes((prev) => !prev)}
                prices={barcodePrices}
                billingInterval={barcodeBillingInterval}
                onBillingIntervalChange={setBarcodeBillingInterval}
                showBillingToggle={selectedPlan === "personal"}
              />
            ) : null}
          </>
        ) : null}

        {isPersonalWithAddons ? (
          <Form method="POST" className="mt-8 w-full">
            <input type="hidden" name="intent" value="personal-with-addons" />
            {wantsAudits && selectedAuditPrice ? (
              <input
                type="hidden"
                name="auditPriceId"
                value={selectedAuditPrice.id}
              />
            ) : null}
            {wantsBarcodes && selectedBarcodePrice ? (
              <input
                type="hidden"
                name="barcodePriceId"
                value={selectedBarcodePrice.id}
              />
            ) : null}
            <Button
              width="full"
              type="submit"
              disabled={disabled}
              data-analytics="cta-start-personal-with-addons"
            >
              {ctaLabel}
            </Button>
          </Form>
        ) : (
          <Button
            to={ctaHref}
            width="full"
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

function AddonToggle({
  label,
  description,
  selected,
  onToggle,
  prices,
  billingInterval,
  onBillingIntervalChange,
  showBillingToggle,
}: {
  label: string;
  description: string;
  selected: boolean;
  onToggle: () => void;
  prices: AddonPrices;
  billingInterval: AuditBillingInterval;
  onBillingIntervalChange: (interval: AuditBillingInterval) => void;
  showBillingToggle: boolean;
}) {
  return (
    <div className="mt-2 w-full">
      <Card
        className={tw(
          "my-0 p-0",
          "transition-shadow",
          selected ? "" : "hover:border-gray-300"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          className={tw(
            "relative flex w-full items-start gap-3 rounded border border-transparent p-4 text-left",
            selected ? "border-primary-400 bg-primary-50" : "border-transparent"
          )}
        >
          <div
            className={tw(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2",
              selected
                ? "border-primary-500 bg-primary-500"
                : "border-gray-300 bg-white"
            )}
            aria-hidden="true"
          >
            {selected ? <CheckIcon className="size-3 text-white" /> : null}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h4 className="text-base font-semibold text-gray-900">{label}</h4>
              <Tag className="bg-primary-50 text-primary-700">7-day trial</Tag>
            </div>
            <p className="mt-1 text-sm text-gray-600">{description}</p>
          </div>
        </button>
      </Card>

      {/* Billing interval cards — shown when addon selected on personal plan */}
      {selected && showBillingToggle ? (
        <AddonBillingCards
          prices={prices}
          billingInterval={billingInterval}
          onBillingIntervalChange={onBillingIntervalChange}
        />
      ) : null}
    </div>
  );
}

function AddonBillingCards({
  prices,
  billingInterval,
  onBillingIntervalChange,
}: {
  prices: AddonPrices;
  billingInterval: AuditBillingInterval;
  onBillingIntervalChange: (interval: AuditBillingInterval) => void;
}) {
  const { month: monthlyPrice, year: yearlyPrice } = prices;

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
              ? "border-2 border-primary-200 bg-primary-25"
              : "border border-gray-200"
          )}
        >
          <p
            className={tw(
              "mb-1 text-sm font-medium",
              billingInterval === "month" ? "text-primary-600" : "text-gray-500"
            )}
          >
            Monthly
          </p>
          <p className="text-2xl font-semibold">
            {fmtPrice(monthlyPrice.unit_amount || 0, monthlyPrice.currency)}
            <span className="text-sm font-normal text-gray-500">/mo</span>
          </p>
          <p className="text-xs text-gray-500">Billed monthly</p>
          <p className="mt-1 text-xs text-gray-500">per workspace</p>
        </button>
      )}
      {yearlyPrice && (
        <button
          type="button"
          onClick={() => onBillingIntervalChange("year")}
          className={tw(
            "relative flex flex-1 cursor-pointer flex-col items-center rounded-lg p-4 text-center transition-colors",
            billingInterval === "year"
              ? "border-2 border-primary-200 bg-primary-25"
              : "border border-gray-200"
          )}
        >
          {yearlyDiscount != null && yearlyDiscount > 0 && (
            <span className="absolute -top-2.5 rounded-full bg-primary-500 px-2 py-0.5 text-[10px] font-semibold text-white">
              Save {yearlyDiscount}%
            </span>
          )}
          <p
            className={tw(
              "mb-1 text-sm font-medium",
              billingInterval === "year" ? "text-primary-600" : "text-gray-500"
            )}
          >
            Yearly
          </p>
          <p className="text-2xl font-semibold">
            {fmtPrice(
              Math.round((yearlyPrice.unit_amount || 0) / 12),
              yearlyPrice.currency
            )}
            <span className="text-sm font-normal text-gray-500">/mo</span>
          </p>
          <p className="text-xs text-gray-500">
            Billed annually{" "}
            {fmtPrice(yearlyPrice.unit_amount || 0, yearlyPrice.currency)}
          </p>
          <p className="mt-1 text-xs text-gray-500">per workspace</p>
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
  icon,
}: {
  planKey: SignupPlan;
  selected: boolean;
  onSelect: (plan: SignupPlan) => void;
  title: string;
  description: string;
  chipLabel: string;
  badgeLabel?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card
      className={tw(
        "flex-1 p-0",
        "transition-shadow",
        selected ? "" : "hover:border-gray-300"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(planKey)}
        className={tw(
          "relative flex size-full flex-col rounded border border-transparent bg-white px-4 py-5 text-left",
          selected ? "border-primary-400 bg-primary-50" : "border-transparent"
        )}
      >
        <div className="absolute right-1.5 top-1.5">
          {badgeLabel ? (
            <Tag className={tw("w-max", " bg-orange-100 text-orange-700")}>
              {badgeLabel}
            </Tag>
          ) : null}
        </div>
        <div>
          {icon}
          <h4 className="mt-3 text-lg font-semibold text-gray-900">{title}</h4>
          <p className="mt-2 text-sm text-gray-600">{description}</p>
          <GrayBadge className="mt-4">{chipLabel}</GrayBadge>
        </div>
      </button>
    </Card>
  );
}
