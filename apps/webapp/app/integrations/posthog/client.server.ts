/**
 * PostHog Server Analytics
 *
 * Thin, best-effort wrapper around `posthog-node` for emitting product events
 * from the server. Two kinds go through it:
 *
 * - funnel events (signup, paid, cancel), which feed the free-to-paid funnel so
 *   we can measure self-serve conversion, a number the marketing site cannot
 *   see because conversion happens inside the app;
 * - usage events for things only the server sees, such as a printable sheet's
 *   preview being generated (printing itself never reaches the server).
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
 * @see {@link file://./../../routes/api+/bookings.$bookingId.generate-pdf.tsx}
 */

import { PostHog } from "posthog-node";

import type { SignupIntentEventProperties } from "~/modules/signup-intent/analytics";
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

/** A printable sheet whose preview the server generates. */
export type PdfPreviewSheet =
  | "booking_checklist"
  | "checkin_receipt"
  | "audit_receipt"
  | "report";

/**
 * The closed set of server-side analytics events and their property shapes.
 * Keeping this a discriminated union type-checks every call site. Properties
 * carry ids and counts only, never personal data.
 */
export type ServerAnalyticsEvent =
  | {
      event: "signup_completed";
      properties: {
        created_with_invite: boolean;
        is_sso: boolean;
      } & SignupIntentEventProperties;
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
    }
  | {
      /**
       * A printable sheet's preview was generated. Sent by the sheet's data
       * loader, which runs when the preview opens; the print itself happens in
       * the browser and is not seen by the server.
       */
      event: "pdf_preview_opened";
      properties: {
        sheet: PdfPreviewSheet;
        organizationId: string;
        /** Rows printed in the sheet's main table. */
        rowCount: number;
        /**
         * Distinct assets across those rows, for `booking_checklist`,
         * `audit_receipt` and `checkin_receipt`. Booking sheets print one row
         * per booking slice, so one asset can fill several rows.
         */
        assetCount?: number;
        /**
         * Rows that matched the report's filters, for `sheet: "report"` only.
         * Can exceed `rowCount` when the printed table is capped.
         */
        totalCount?: number;
        /** Which report, for `sheet: "report"` only. */
        reportId?: string;
      };
    };

/**
 * Emit a server-side analytics event to PostHog. Best-effort: it does not
 * await, never throws, and is a silent no-op when PostHog is not configured,
 * so it is always safe to call from inside signup, a webhook handler or a
 * loader.
 *
 * @param args - The event name + its typed properties, plus `distinctId`
 *   (use the Shelf user id so events stitch to one person), optional
 *   `groups` for org-level group analytics, and optional `setOnce`: person
 *   properties written only if the person does not have them yet (PostHog's
 *   `$set_once`), for facts about how someone first arrived.
 */
export function captureServerEvent(
  args: ServerAnalyticsEvent & {
    distinctId: string;
    groups?: Record<string, string>;
    setOnce?: Record<string, string | number | boolean>;
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
      properties: args.setOnce
        ? { ...args.properties, $set_once: args.setOnce }
        : args.properties,
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
