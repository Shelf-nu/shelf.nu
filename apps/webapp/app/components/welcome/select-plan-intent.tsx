/**
 * Plan-page pieces that depend on the intent a signup link carried.
 *
 * Someone whose link asked for a Team workspace skips the Personal/Team
 * question on `/welcome` and lands on `/select-plan` directly. That page then
 * needs a way back to the free Personal workspace, and its calls to action
 * ordered by what the link asked for (trial first, or subscribe first).
 * Without an intent the page shows the single trial button it always had.
 *
 * @see {@link file://./../../routes/_welcome+/select-plan.tsx}
 * @see {@link file://./../../modules/signup-intent/schema.ts}
 */
import { Button } from "~/components/shared/button";
import type { PlanIntent } from "~/modules/signup-intent/schema";

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
 * `intent` value tells it whether to open a trial or a Stripe checkout.
 *
 * @param planIntent - The plan the signup link asked for, if any. A Team
 *   intent offers both actions with the requested one first; anything else
 *   keeps the single trial button.
 * @param disabled - Whether the form is submitting or has no price selected
 * @param freeTrialDays - Length of the trial, from `config.freeTrialDays`
 */
export function SelectPlanSubmitButtons({
  planIntent,
  disabled,
  freeTrialDays,
}: {
  planIntent: PlanIntent | null;
  disabled: boolean;
  freeTrialDays: number;
}) {
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
