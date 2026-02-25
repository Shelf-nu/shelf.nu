/**
 * Stripe Webhook Handler
 *
 * Enable these events in Stripe Dashboard → Developers → Webhooks:
 *
 * Checkout:
 *   - checkout.session.completed
 *
 * Subscriptions:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.paused
 *   - customer.subscription.deleted
 *   - customer.subscription.trial_will_end
 *
 * Invoices:
 *   - invoice.paid
 *   - invoice.payment_failed
 *   - invoice.overdue
 *   - invoice.voided
 *   - invoice.marked_uncollectible
 *
 * Payment Methods:
 *   - payment_method.attached
 *   - payment_method.detached
 */

import type { ActionFunctionArgs } from "react-router";
import {
  handleCheckoutCompleted,
  handleInvoiceOverdue,
  handleInvoicePaid,
  handleInvoicePaymentFailed,
  handleInvoiceResolved,
  handlePaymentMethodAttached,
  handlePaymentMethodDetached,
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
  handleSubscriptionPaused,
  handleSubscriptionUpdated,
  handleTrialWillEnd,
} from "~/modules/stripe-webhook/handlers.server";
import {
  constructVerifiedWebhookEvent,
  PaymentMethodWithoutCustomerResponse,
} from "~/modules/stripe-webhook/helpers.server";
import { ShelfError, makeShelfError } from "~/utils/error";

export async function action({ request }: ActionFunctionArgs) {
  try {
    const { event, customerId, user } =
      await constructVerifiedWebhookEvent(request);

    // Custom install users — no processing needed
    if (!user) {
      return new Response(null, { status: 200 });
    }

    switch (event.type) {
      case "checkout.session.completed":
        return await handleCheckoutCompleted(event, user);
      case "customer.subscription.created":
        return await handleSubscriptionCreated(event, user);
      case "customer.subscription.paused":
        return await handleSubscriptionPaused(event, user);
      case "customer.subscription.updated":
        return await handleSubscriptionUpdated(event, user);
      case "customer.subscription.deleted":
        return await handleSubscriptionDeleted(event, user);
      case "invoice.payment_failed":
        return await handleInvoicePaymentFailed(event, user, customerId);
      case "invoice.paid":
        return await handleInvoicePaid(event, user, customerId);
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        return await handleInvoiceResolved(event, user, customerId);
      case "invoice.overdue":
        return await handleInvoiceOverdue(event, user, customerId);
      case "customer.subscription.trial_will_end":
        return await handleTrialWillEnd(event, user);
      case "payment_method.attached":
        return await handlePaymentMethodAttached(event, user, customerId);
      case "payment_method.detached":
        return await handlePaymentMethodDetached(event, user, customerId);
      default:
        throw new ShelfError({
          cause: null,
          message:
            "Unhandled event. Maybe you forgot to handle this event type? Check the Stripe dashboard.",
          additionalData: { event },
          label: "Stripe webhook",
          status: 500,
          shouldBeCaptured: false,
        });
    }
  } catch (cause) {
    // Payment method events without a customer are not errors — return 200
    if (cause instanceof PaymentMethodWithoutCustomerResponse) {
      return new Response(null, { status: 200 });
    }
    const reason = makeShelfError(cause);
    // Return minimal body to avoid leaking sensitive Stripe event data
    // from additionalData. The ShelfError is still captured server-side.
    return new Response(null, { status: reason.status });
  }
}
