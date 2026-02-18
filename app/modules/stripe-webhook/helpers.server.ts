import type { TierId } from "@prisma/client";
import Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { unpaidInvoiceAdminText } from "~/emails/stripe/unpaid-invoice";
import {
  ADMIN_EMAIL,
  CUSTOM_INSTALL_CUSTOMERS,
  STRIPE_WEBHOOK_ENDPOINT_SECRET,
} from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { stripe } from "~/utils/stripe.server";

/** The user shape returned by the webhook's initial DB query */
export type WebhookUser = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  tierId: TierId;
  warnForNoPaymentMethod: boolean;
};

export const subscriptionTiersPriority: Record<TierId, number> = {
  free: 0,
  tier_1: 1, // plus
  tier_2: 2, // team
  custom: 3, // Custom
};

/**
 * Checks if the subscription is an add-on product that should be acknowledged but not processed.
 * Add-ons are explicitly marked with product_type='addon' metadata in Stripe.
 *
 * @returns true if it's an add-on (caller should return early with 200)
 * @returns false if tierId exists (caller should continue processing)
 * @throws ShelfError if no tierId and not an add-on product
 */
export function isAddonSubscription({
  tierId,
  productType,
  event,
  additionalData,
}: {
  tierId: string | undefined;
  productType: string | undefined;
  event: Stripe.Event;
  additionalData?: Record<string, unknown>;
}): boolean {
  if (tierId) return false;
  if (productType === "addon") return true;

  throw new ShelfError({
    cause: null,
    message: "No tier ID found for non-addon product",
    additionalData: { event, productType, ...additionalData },
    label: "Stripe webhook",
    status: 500,
  });
}

/** Returns true if `newTier` is strictly higher than `currentTier` */
export function isHigherTier(newTier: TierId, currentTier: TierId): boolean {
  return (
    subscriptionTiersPriority[newTier] > subscriptionTiersPriority[currentTier]
  );
}

/** Returns true if `newTier` is higher than or equal to `currentTier` */
export function isHigherOrEqualTier(
  newTier: TierId,
  currentTier: TierId
): boolean {
  return (
    subscriptionTiersPriority[newTier] >= subscriptionTiersPriority[currentTier]
  );
}

/**
 * Sends the admin invoice notification email if ADMIN_EMAIL is configured.
 * Wraps the repeated `if (ADMIN_EMAIL) { sendEmail(...) }` pattern.
 */
export function sendAdminInvoiceEmail({
  user,
  eventType,
  invoiceId,
  subject,
}: {
  user: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
  };
  eventType: string;
  invoiceId: string;
  subject: string;
}) {
  if (ADMIN_EMAIL) {
    sendEmail({
      to: ADMIN_EMAIL,
      subject,
      text: unpaidInvoiceAdminText({ user, eventType, invoiceId }),
    });
  }
}

/**
 * Validates the incoming webhook request and returns the verified event + user.
 *
 * Handles: signature validation, customer ID extraction (including payment_method.detached
 * edge case), early returns for payment methods without customers, user lookup,
 * and custom install customer check.
 *
 * @returns `{ event, customerId, user }` where `user` is null for custom install customers
 * @throws ShelfError on validation failure
 */
export async function constructVerifiedWebhookEvent(request: Request): Promise<{
  event: Stripe.Event;
  customerId: string;
  user: WebhookUser | null;
}> {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    throw new ShelfError({
      cause: null,
      message: "Missing stripe-signature header",
      label: "Stripe webhook",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  if (!STRIPE_WEBHOOK_ENDPOINT_SECRET) {
    throw new ShelfError({
      cause: null,
      message: "STRIPE_WEBHOOK_ENDPOINT_SECRET is not configured",
      label: "Stripe webhook",
      status: 500,
      shouldBeCaptured: true,
    });
  }

  if (!stripe) {
    throw new ShelfError({
      cause: null,
      message:
        "Stripe client is not initialized. Check that STRIPE_SECRET_KEY is configured and premium features are enabled.",
      label: "Stripe webhook",
      status: 500,
      shouldBeCaptured: true,
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      sig,
      STRIPE_WEBHOOK_ENDPOINT_SECRET
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        cause instanceof Stripe.errors.StripeSignatureVerificationError
          ? "Stripe webhook signature verification failed"
          : "Failed to construct Stripe webhook event",
      label: "Stripe webhook",
      status:
        cause instanceof Stripe.errors.StripeSignatureVerificationError
          ? 400
          : 500,
      shouldBeCaptured: true,
      additionalData: {
        errorType:
          cause instanceof Error ? cause.constructor.name : typeof cause,
      },
    });
  }

  const eventData = event.data.object as { customer: string | null };

  // For payment_method.detached, customer is null on the object but available in previous_attributes
  let customerId = eventData.customer;
  if (!customerId && event.type === "payment_method.detached") {
    const previousAttributes = event.data.previous_attributes as
      | { customer?: string }
      | undefined;
    customerId = previousAttributes?.customer ?? null;
  }

  // If we still don't have a customerId, return early for payment method events
  // (this can happen if the payment method was never attached to a customer)
  if (!customerId) {
    if (
      event.type === "payment_method.attached" ||
      event.type === "payment_method.detached"
    ) {
      // Caller should return 200 — we signal this by throwing a special non-error response.
      // Instead, we use a sentinel: returning a response directly isn't possible here,
      // so we throw a tagged error the caller can catch.
      throw new PaymentMethodWithoutCustomerResponse();
    }
    // For other events, customerId is required
    throw new ShelfError({
      cause: null,
      message: "No customer ID found in event",
      additionalData: { event: event.type },
      label: "Stripe webhook",
      status: 400,
    });
  }

  const user = await db.user
    .findFirstOrThrow({
      where: { customerId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        tierId: true,
        warnForNoPaymentMethod: true,
      },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "No user found",
        additionalData: { customerId },
        label: "Stripe webhook",
        status: 500,
      });
    });

  // Custom install users — no processing needed
  const customInstallUsers = (CUSTOM_INSTALL_CUSTOMERS ?? "").split(",");
  if (customInstallUsers.includes(customerId)) {
    return { event, customerId, user: null };
  }

  return { event, customerId, user };
}

/**
 * Sentinel class used when a payment method event has no customer.
 * The route catches this and returns 200.
 */
export class PaymentMethodWithoutCustomerResponse {
  readonly _tag = "PaymentMethodWithoutCustomerResponse" as const;
}
