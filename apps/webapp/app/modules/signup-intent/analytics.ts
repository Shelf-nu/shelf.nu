/**
 * Signup intent → analytics properties
 *
 * The plan and campaign a signup link carried are recorded twice: on the
 * user's business-intel record (the source of truth, written at onboarding)
 * and on the `signup_completed` PostHog event (written when the account is
 * created), so funnel reports built in PostHog agree with the database.
 *
 * Both helpers return nothing for a signup without an intent, so the event
 * for such a signup stays exactly as it is without this module.
 *
 * Pure module: no PostHog client, no server imports.
 *
 * @see {@link file://./schema.ts} — what an intent is
 * @see {@link file://./../../integrations/posthog/client.server.ts} — the event sink
 * @see {@link file://./../user/service.server.ts} — emits `signup_completed`
 */
import type { SignupIntent } from "./schema";

/** Event properties naming what the signup link asked for. */
export type SignupIntentEventProperties = {
  signup_plan?: string;
  signup_trial?: boolean;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
};

/**
 * Person properties written once, on the first event that carries them, so a
 * person keeps the campaign that first brought them in. The `$initial_utm_*`
 * names are PostHog's own for campaign attribution.
 */
export type SignupIntentInitialPersonProperties = {
  initial_signup_plan?: string;
  initial_signup_trial?: boolean;
  $initial_utm_source?: string;
  $initial_utm_medium?: string;
  $initial_utm_campaign?: string;
  $initial_utm_content?: string;
};

/** Keeps only the entries that carry a value, so absent fields stay absent. */
function definedEntries<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as T;
}

/**
 * The `signup_completed` event properties for an intent.
 *
 * @param intent - The intent carried from the signup link, if any
 * @returns The properties to merge into the event; empty without an intent
 */
export function signupIntentEventProperties(
  intent: SignupIntent | null | undefined
): SignupIntentEventProperties {
  if (!intent) {
    return {};
  }
  return definedEntries({
    signup_plan: intent.plan,
    signup_trial: intent.trial,
    utm_source: intent.utmSource,
    utm_medium: intent.utmMedium,
    utm_campaign: intent.utmCampaign,
    utm_content: intent.utmContent,
  });
}

/**
 * The set-once person properties for an intent.
 *
 * @param intent - The intent carried from the signup link, if any
 * @returns The properties to set once on the person, or `undefined` without
 *   an intent so no person write happens at all
 */
export function signupIntentInitialPersonProperties(
  intent: SignupIntent | null | undefined
): SignupIntentInitialPersonProperties | undefined {
  if (!intent) {
    return undefined;
  }
  const properties = definedEntries({
    initial_signup_plan: intent.plan,
    initial_signup_trial: intent.trial,
    $initial_utm_source: intent.utmSource,
    $initial_utm_medium: intent.utmMedium,
    $initial_utm_campaign: intent.utmCampaign,
    $initial_utm_content: intent.utmContent,
  });
  return Object.keys(properties).length > 0 ? properties : undefined;
}
