import { useState } from "react";
import { useNavigation } from "@remix-run/react";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { ShelfSymbolLogo } from "../marketing/logos";
import { Button } from "../shared/button";
import { Card } from "../shared/card";
import { GrayBadge } from "../shared/gray-badge";
import { Tag } from "../shared/tag";

type SignupPlan = "personal" | "team";

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
    description:
      "For organizations and labs. Includes collaboration features with a 7-day free trial. No credit card required.",
    chip: "7-day trial",
    badge: "Recommended",
    analytics: "cta-next-team",
    ctaLabel: "Next: Select a plan",
    href: "/select-plan",
  },
};

export function ChoosePurpose() {
  const [selectedPlan, setSelectedPlan] = useState<SignupPlan | null>(null);
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state) || !selectedPlan;

  const selectedDetails = selectedPlan ? PLAN_DETAILS[selectedPlan] : null;

  return (
    <>
      <div className="flex flex-col items-center p-4 sm:p-6">
        <ShelfSymbolLogo className="mb-4 size-8" />
        <div className="mb-8 max-w-2xl text-center">
          <h3 className="text-2xl font-semibold text-gray-900">
            How would you like to get started with Shelf?
          </h3>
          <p className="mt-3 text-base text-gray-600">
            Your choice determines which features we prepare for you. You can
            always switch later.
          </p>
          <p className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
            If your organization already uses Shelf, you don’t need to create a
            new workspace — look for your email invite or sign in instead.
          </p>
        </div>
        <div className="flex w-full max-w-3xl flex-col gap-4">
          {(Object.keys(PLAN_DETAILS) as Array<SignupPlan>).map((planKey) => {
            const plan = PLAN_DETAILS[planKey];
            const isSelected = selectedPlan === planKey;
            return (
              <div key={planKey} className="space-y-2">
                <PlanCard
                  planKey={planKey}
                  onSelect={setSelectedPlan}
                  selected={isSelected}
                  description={plan.description}
                  title={plan.title}
                  chipLabel={plan.chip}
                  badgeLabel={plan.badge}
                />
                {plan.helper ? (
                  <p className="pl-6 text-sm text-gray-500">{plan.helper}</p>
                ) : null}
              </div>
            );
          })}
        </div>
        <Button
          to={selectedDetails?.href ?? "/assets"}
          width="full"
          className="mt-8"
          disabled={disabled}
          data-analytics={selectedDetails?.analytics}
        >
          {selectedDetails?.ctaLabel ?? "Start using Shelf"}
        </Button>
      </div>
    </>
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
        selected ? "shadow-lg" : "hover:shadow-md"
      )}
    >
      <button
        type="button"
        onClick={() => onSelect(planKey)}
        className={tw(
          "flex w-full items-start justify-between gap-4 rounded border-2 border-transparent bg-white px-6 py-5 text-left",
          selected ? "border-primary-300 bg-primary-50" : "border-transparent"
        )}
      >
        <div className="flex flex-col gap-3">
          <Tag
            className={tw(
              "w-max",
              planKey === "team"
                ? "bg-orange-100 text-orange-700"
                : "bg-primary-50 text-primary-700"
            )}
          >
            {chipLabel}
          </Tag>
          <div>
            <h4 className="text-lg font-semibold text-gray-900">{title}</h4>
            <p className="mt-2 text-sm text-gray-600">{description}</p>
          </div>
        </div>
        {badgeLabel ? <GrayBadge>{badgeLabel}</GrayBadge> : null}
      </button>
    </Card>
  );
}
