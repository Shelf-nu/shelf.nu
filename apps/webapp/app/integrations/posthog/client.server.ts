/**
 * PostHog Server Analytics
 *
 * Thin, best-effort wrapper around `posthog-node` for emitting product funnel
 * events (signup → paid → cancel) from the server. These feed the free→paid
 * funnel in PostHog so we can measure self-serve conversion — the metric the
 * marketing site can't see because conversion happens inside the app.
 *
 * Design rules (do not relax without discussion):
 * - **Never throws / never blocks.** Analytics must not be able to break a
 *   signup or a Stripe webhook. Every capture is wrapped and swallowed.
 * - **No-op when unconfigured.** If `POSTHOG_API_KEY` is unset (local dev,
 *   tests, self-host), nothing happens.
 * - **No PII in properties.** Pass IDs, tiers, amounts — never raw emails.
 *
 * @see {@link file://./../../modules/stripe-webhook/handlers.server.ts}
 * @see {@link file://./../../modules/user/service.server.ts}
 */

import { PostHog } from "posthog-node";

import { POSTHOG_API_KEY, POSTHOG_HOST } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/** Lazily-initialised singleton. Stays `null` once we know there is no key. */
let client: PostHog | null = null;
let initialised = false;

/**
 * Returns the shared PostHog client, or `null` when `POSTHOG_API_KEY` is not
 * configured. Initialised once and reused across requests — the server is
 * long-running, so the library's background flushing applies.
 *
 * @returns The PostHog client, or `null` when analytics is disabled.
 */
function getPostHogClient(): PostHog | null {
  if (initialised) {
    return client;
  }
  initialised = true;

  if (!POSTHOG_API_KEY) {
    client = null;
    return null;
  }

  client = new PostHog(POSTHOG_API_KEY, {
    host: POSTHOG_HOST || "https://us.i.posthog.com",
    // Low server-side volume: flush each event promptly rather than batching.
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

/**
 * The closed set of server-side funnel events and their property shapes.
 * Keeping this a discriminated union type-checks every call site.
 */
export type ServerFunnelEvent =
  | {
      event: "signup_completed";
      properties: { created_with_invite: boolean; is_sso: boolean };
    }
  | {
      event: "upgrade_completed";
      properties: {
        tierId: string;
        billing_cycle: string | null;
        mrr: number | null;
        via: "direct" | "upgrade" | "trial_conversion";
      };
    }
  | {
      event: "subscription_cancelled";
      properties: { tierId: string };
    };

/**
 * Emit a server-side funnel event to PostHog. Best-effort: it does not await,
 * never throws, and is a silent no-op when PostHog is not configured — so it
 * is always safe to call from inside signup or a webhook handler.
 *
 * @param args - The event name + its typed properties, plus `distinctId`
 *   (use the Shelf user id so events stitch to one person) and optional
 *   `groups` for org-level group analytics.
 */
export function captureServerEvent(
  args: ServerFunnelEvent & {
    distinctId: string;
    groups?: Record<string, string>;
  }
): void {
  try {
    const posthog = getPostHogClient();
    if (!posthog) {
      return;
    }
    posthog.capture({
      distinctId: args.distinctId,
      event: args.event,
      properties: args.properties,
      groups: args.groups,
    });
  } catch (cause) {
    // why: analytics is best-effort — a transport/logging failure must never
    // surface to the caller (signup, Stripe webhook). Log and swallow.
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to capture server analytics event",
        additionalData: { event: args.event },
        label: "Analytics",
        shouldBeCaptured: false,
      })
    );
  }
}
