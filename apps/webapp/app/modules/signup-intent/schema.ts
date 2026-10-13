/**
 * Signup intent
 *
 * The parameters a signup link can carry into `/join`: the plan the visitor
 * picked on the website (`plan=team&trial=true`), the campaign that sent them
 * (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`) and an in-app
 * `redirectTo`. Together they say what the person came to do, never what
 * they may do, so nothing here is security-relevant: the values steer copy
 * and routing during onboarding and are stored for attribution.
 *
 * Every field is optional and validated on its own, so a malformed campaign
 * value never drops the plan next to it. Values a reader cannot use (an
 * unknown plan, an over-long utm) are ignored rather than rejected.
 *
 * Pure module: safe to import from route components and from the server.
 *
 * @see {@link file://./cookie.server.ts} — carries the intent between requests
 * @see {@link file://./../../routes/_auth+/join.tsx} — reads it from the URL
 * @see {@link file://./../../routes/_welcome+/onboarding.tsx} — consumes it
 * @see {@link file://./../../routes/_welcome+/select-plan.tsx} — reads the plan part back
 */
import { z } from "zod";

/** Plans a signup link may ask for. Anything else is ignored. */
export const SIGNUP_PLANS = ["team", "plus"] as const;

/** One of {@link SIGNUP_PLANS}: the plan a signup link asked for. */
export type SignupPlan = (typeof SIGNUP_PLANS)[number];

/** Campaign values are labels for reporting; anything longer is not one. */
const MAX_UTM_LENGTH = 100;

/** An in-app path. Only ever applied through `safeRedirect`. */
const MAX_REDIRECT_TO_LENGTH = 500;

const utmValue = z.string().trim().min(1).max(MAX_UTM_LENGTH);

/**
 * `plan` is compared case-insensitively so a hand-typed `Team` still counts.
 */
const planValue = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(SIGNUP_PLANS)
);

/**
 * `trial` arrives as a query-string flag (`true`/`1`, `false`/`0`) and is
 * stored as a boolean; both shapes are accepted so the same schema validates
 * the URL and the cookie payload.
 */
const trialValue = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }
  return undefined;
}, z.boolean());

/**
 * The shape of a carried intent. Validates both the values read from the
 * signup URL (as strings) and the stored cookie payload (already typed), so
 * the two can never drift apart.
 */
export const SignupIntentSchema = z.object({
  plan: planValue.optional(),
  trial: trialValue.optional(),
  redirectTo: z.string().min(1).max(MAX_REDIRECT_TO_LENGTH).optional(),
  utmSource: utmValue.optional(),
  utmMedium: utmValue.optional(),
  utmCampaign: utmValue.optional(),
  utmContent: utmValue.optional(),
});

/** What a signup link asked for. At least one field is set. */
export type SignupIntent = z.infer<typeof SignupIntentSchema>;

type SignupIntentField = keyof SignupIntent;

/** Query-string name for each intent field. */
const SEARCH_PARAM_NAMES: Record<SignupIntentField, string> = {
  plan: "plan",
  trial: "trial",
  redirectTo: "redirectTo",
  utmSource: "utm_source",
  utmMedium: "utm_medium",
  utmCampaign: "utm_campaign",
  utmContent: "utm_content",
};

/**
 * Reads a signup intent from a URL's query string.
 *
 * Each field is validated independently: an invalid or missing value leaves
 * that field unset and never affects the others.
 *
 * @param searchParams - The query string of the request being served
 * @returns The intent, or `null` when the query string carries none
 */
export function parseSignupIntentFromSearchParams(
  searchParams: URLSearchParams
): SignupIntent | null {
  const intent: SignupIntent = {};

  for (const field of Object.keys(SEARCH_PARAM_NAMES) as SignupIntentField[]) {
    const raw = searchParams.get(SEARCH_PARAM_NAMES[field]);
    if (raw === null) {
      continue;
    }
    const result = SignupIntentSchema.shape[field].safeParse(raw);
    if (result.success && result.data !== undefined) {
      // The union of field types cannot be narrowed per key in a loop; each
      // value was produced by that key's own schema above.
      (intent as Record<SignupIntentField, unknown>)[field] = result.data;
    }
  }

  return Object.keys(intent).length > 0 ? intent : null;
}

/**
 * The plan part of an intent, as the plan page receives it from onboarding.
 * `trial` is always decided: the page orders its calls to action by it.
 */
export type PlanIntent = { plan: SignupPlan; trial: boolean };

/**
 * Reads the plan part of an intent from a URL's query string
 * (`/select-plan?plan=team&trial=true`).
 *
 * @param searchParams - The query string of the request being served
 * @returns The plan intent, or `null` when the query string names no plan
 */
export function parsePlanIntentFromSearchParams(
  searchParams: URLSearchParams
): PlanIntent | null {
  const intent = parseSignupIntentFromSearchParams(searchParams);
  if (!intent?.plan) {
    return null;
  }
  return { plan: intent.plan, trial: intent.trial ?? false };
}

/**
 * Whether the intent asks for a Team workspace.
 *
 * @param intent - The carried intent, if any
 */
export function hasTeamPlanIntent(
  intent: SignupIntent | null | undefined
): intent is SignupIntent & { plan: "team" } {
  return intent?.plan === "team";
}

/**
 * The plan part of an intent as a query string, for handing it from
 * onboarding to the plan page (`/select-plan?plan=team&trial=true`).
 *
 * Only `plan` and `trial` travel: the campaign values were stored during
 * onboarding, and `redirectTo` belongs to the code confirmation, which
 * honours it only for an account that has already onboarded.
 *
 * @param intent - An intent with a plan
 * @returns A query string without the leading `?`
 */
export function planIntentSearchParams(
  intent: SignupIntent & { plan: SignupPlan }
): string {
  const params = new URLSearchParams({ plan: intent.plan });
  if (intent.trial !== undefined) {
    params.set("trial", String(intent.trial));
  }
  return params.toString();
}

/**
 * The one-line confirmation shown on the signup page for a Team intent, or
 * `null` when the page should look exactly as it does without an intent.
 *
 * @param intent - The intent read from the signup URL, if any
 * @param freeTrialDays - Length of the Team trial, from `config.freeTrialDays`
 */
export function signupIntentNotice({
  intent,
  freeTrialDays,
}: {
  intent: SignupIntent | null | undefined;
  freeTrialDays: number;
}): string | null {
  if (!hasTeamPlanIntent(intent)) {
    return null;
  }
  return intent.trial
    ? `You're starting a Team trial. ${freeTrialDays} days, no credit card.`
    : "You're signing up for the Team plan.";
}

/**
 * Where onboarding sends a freshly onboarded user.
 *
 * Invited users go straight to the workspace that invited them. A Team
 * intent skips the Personal/Team question and lands on the plan page, but
 * only where plans exist: without premium features that page cannot render,
 * and `/welcome` already knows to send such users on to their assets.
 * Everyone else gets the Personal/Team question as before.
 *
 * @param redirectViaInvite - The user was onboarded through a workspace invite
 * @param signupIntent - The intent carried from the signup link, if any
 * @param premiumFeaturesEnabled - `ENABLE_PREMIUM_FEATURES` for this deployment
 */
export function resolveOnboardingDestination({
  redirectViaInvite,
  signupIntent,
  premiumFeaturesEnabled,
}: {
  redirectViaInvite: boolean;
  signupIntent: SignupIntent | null;
  premiumFeaturesEnabled: boolean;
}): string {
  if (redirectViaInvite) {
    return "/assets";
  }
  if (premiumFeaturesEnabled && hasTeamPlanIntent(signupIntent)) {
    return `/select-plan?${planIntentSearchParams(signupIntent)}`;
  }
  return "/welcome";
}
