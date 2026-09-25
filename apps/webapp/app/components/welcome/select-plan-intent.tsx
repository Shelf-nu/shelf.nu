/**
 * Plan-page pieces that depend on the intent a signup link carried.
 *
 * Someone whose link asked for a Team workspace skips the Personal/Team
 * question on `/welcome` and lands on `/select-plan` directly. That page then
 * needs a way back to the free Personal workspace, and its calls to action
 * ordered by what the link asked for (trial first, or subscribe first).
 * Without a Team intent the page renders one primary trial button.
 *
 * @see {@link file://./../../routes/_welcome+/select-plan.tsx}
 * @see {@link file://./../../modules/signup-intent/schema.ts}
 */
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import type { PlanIntent } from "~/modules/signup-intent/schema";

/** The trial wording on the plan page, which depends on the offered actions. */
export type SelectPlanTrialCopy = {
  /** Line under the page heading. */
  subheading: string;
  /** Qualifier after "Cost summary": when the shown total is billed. */
  costSummaryNote: string;
  /** Tag on each add-on card, or `null` to show none. */
  addonTrialTag: string | null;
};

/**
 * The plan page's trial wording for the actions it offers.
 *
 * Without a Team intent the only action is the trial, so the page talks about
 * nothing else. A Team intent adds "Subscribe", which goes to Stripe Checkout
 * and bills straight away, so any wording that promises a trial must also say
 * what subscribing costs. When subscribing leads, the add-on cards drop their
 * trial tag: the trial is the secondary choice there.
 *
 * @param planIntent - The plan the signup link asked for, if any
 * @param freeTrialDays - Length of the trial, from `config.freeTrialDays`
 */
export function selectPlanTrialCopy({
  planIntent,
  freeTrialDays,
}: {
  planIntent: PlanIntent | null;
  freeTrialDays: number;
}): SelectPlanTrialCopy {
  if (planIntent?.plan !== "team") {
    return {
      subheading: `No credit card or payment required to start your ${freeTrialDays}-day trial.`,
      costSummaryNote: "(applied after free trial ends)",
      addonTrialTag: `${freeTrialDays}-day trial`,
    };
  }

  if (planIntent.trial) {
    return {
      subheading: `No credit card or payment required to start your ${freeTrialDays}-day trial.`,
      costSummaryNote:
        "(applied after the free trial ends, or today if you subscribe now)",
      addonTrialTag: `${freeTrialDays}-day trial`,
    };
  }

  return {
    subheading: `Subscribe now, or start a ${freeTrialDays}-day free trial with no credit card.`,
    costSummaryNote: "(billed today, or after the free trial if you start one)",
    addonTrialTag: null,
  };
}

/**
 * The way back for someone who skipped the Personal/Team question. It does
 * what choosing Personal on `/welcome` does: opens the free Personal
 * workspace every account already has.
 */
export function PersonalWorkspaceEscapeLink() {
  return (
    <p className="text-center text-sm text-gray-500">
      <Button
        variant="link-gray"
        to="/assets"
        data-analytics="cta-continue-personal"
      >
        Continue with a free Personal workspace instead
      </Button>
    </p>
  );
}

/**
 * The plan form's submit buttons. Both post to the subscription action; the
 * `intent` value tells it whether to open a trial or a Stripe checkout. The
 * buttons disable themselves while the form submits, and stay disabled while
 * no price is selected, since the action needs one.
 *
 * @param planIntent - The plan the signup link asked for, if any. A Team
 *   intent offers both actions with the requested one first; anything else
 *   renders one primary trial button.
 * @param noPriceSelected - Whether the form has no Stripe price to post yet
 * @param freeTrialDays - Length of the trial, from `config.freeTrialDays`
 */
export function SelectPlanSubmitButtons({
  planIntent,
  noPriceSelected,
  freeTrialDays,
}: {
  planIntent: PlanIntent | null;
  noPriceSelected: boolean;
  freeTrialDays: number;
}) {
  const disabled = useDisabled() || noPriceSelected;

  const trialButton = (primary: boolean) => (
    <Button
      width="full"
      type="submit"
      name="intent"
      value="trial"
      variant={primary ? "primary" : "secondary"}
      disabled={disabled}
      data-analytics="cta-start-trial"
    >
      {primary
        ? `Start ${freeTrialDays}-day free trial`
        : `Start ${freeTrialDays}-day free trial instead`}
    </Button>
  );

  const subscribeButton = (primary: boolean) => (
    <Button
      width="full"
      type="submit"
      name="intent"
      value="subscribe"
      variant={primary ? "primary" : "secondary"}
      disabled={disabled}
      data-analytics="cta-subscribe"
    >
      {primary ? "Subscribe to Team" : "Subscribe now instead"}
    </Button>
  );

  if (planIntent?.plan !== "team") {
    return trialButton(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {planIntent.trial ? trialButton(true) : subscribeButton(true)}
      {planIntent.trial ? subscribeButton(false) : trialButton(false)}
    </div>
  );
}
