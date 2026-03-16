import type { Sb } from "@shelf/database";
import type Stripe from "stripe";
import { sbDb } from "~/database/supabase.server";
import { sendEmail } from "~/emails/mail.server";
import { sendAuditTrialEndsSoonEmail } from "~/emails/stripe/audit-trial-ends-soon";
import { subscriptionGrantedText } from "~/emails/stripe/subscription-granted";
import { trialEndsSoonEmailText } from "~/emails/stripe/trial-ends-soon";
import { unpaidInvoiceUserText } from "~/emails/stripe/unpaid-invoice";
import { sendTeamTrialWelcomeEmail } from "~/emails/stripe/welcome-to-trial";
import { handleAuditAddonWebhook } from "~/modules/audit/addon.server";
import { resetPersonalWorkspaceBranding } from "~/modules/organization/service.server";
import { ShelfError } from "~/utils/error";
import {
  customerHasPaymentMethod,
  fetchStripeSubscription,
  getCustomerActiveSubscription,
  getCustomerNotificationData,
  getDataFromStripeEvent,
  getInvoiceNotificationData,
  getStripeCustomer,
  stripe,
  type CustomerWithSubscriptions,
} from "~/utils/stripe.server";

import {
  isAddonSubscription,
  isHigherOrEqualTier,
  isHigherTier,
  sendAdminInvoiceEmail,
  type WebhookUser,
} from "./helpers.server";

const OK = () => new Response(null, { status: 200 });

/** Helper to update a user by their Stripe customerId */
async function updateUserByCustomerId(
  customerId: string,
  data: Record<string, unknown>,
  context: { event: Stripe.Event; extraData?: Record<string, unknown> }
) {
  const { error } = await sbDb
    .from("User")
    .update(data)
    .eq("customerId", customerId);

  if (error) {
    throw new ShelfError({
      cause: error,
      message: "Failed to update user",
      additionalData: {
        customerId,
        event: context.event,
        ...context.extraData,
      },
      label: "Stripe webhook",
      status: 500,
    });
  }
}

// ─── Checkout ──────────────────────────────────────────────

export async function handleCheckoutCompleted(
  event: Stripe.Event,
  _user: WebhookUser
) {
  const { subscription: subscriptionId } = event.data
    .object as Stripe.Checkout.Session;

  if (!subscriptionId) {
    throw new ShelfError({
      cause: null,
      message: "No subscription ID found",
      additionalData: { event },
      label: "Stripe webhook",
      status: 500,
    });
  }

  const subscription = await fetchStripeSubscription(subscriptionId as string);

  const product = subscription.items.data[0].plan.product as Stripe.Product;
  const customerId = subscription.customer as string;
  const tierId = product?.metadata?.shelf_tier;
  const productType = product?.metadata?.product_type;

  if (
    isAddonSubscription({
      tierId,
      productType,
      event,
      additionalData: { subscription },
    })
  ) {
    const organizationId = subscription?.metadata?.organizationId;
    if (product?.metadata?.addon_type === "audits" && organizationId) {
      await handleAuditAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  await updateUserByCustomerId(customerId, { tierId }, { event });

  return OK();
}

// ─── Subscription Created ──────────────────────────────────

export async function handleSubscriptionCreated(
  event: Stripe.Event,
  user: WebhookUser
) {
  const { subscription, customerId, tierId, productType, product } =
    await getDataFromStripeEvent(event);

  if (
    isAddonSubscription({
      tierId,
      productType,
      event,
      additionalData: { subscription },
    })
  ) {
    const organizationId = subscription?.metadata?.organizationId;
    if (product?.metadata?.addon_type === "audits" && organizationId) {
      await handleAuditAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  const isTransferredSubscription =
    !!subscription.metadata?.transferred_from_subscription;
  const isTrialSubscription =
    !!subscription.trial_end && !!subscription.trial_start;

  if (isTrialSubscription && !isTransferredSubscription) {
    await updateUserByCustomerId(
      customerId,
      { tierId, usedFreeTrial: true },
      { event }
    );

    // Fetch user email/name for welcome email
    const { data: trialUser } = await sbDb
      .from("User")
      .select("email, firstName")
      .eq("customerId", customerId)
      .single();

    if (trialUser) {
      void sendTeamTrialWelcomeEmail({
        email: trialUser.email,
        firstName: trialUser.firstName,
      });
    }
  } else if (isTransferredSubscription) {
    // Transferred subscription: update tier but skip welcome emails
    // and don't set usedFreeTrial (already handled in transferOwnership)
    await updateUserByCustomerId(customerId, { tierId }, { event });
  } else {
    await updateUserByCustomerId(customerId, { tierId }, { event });

    const { emailsToNotify, customerName } = await getCustomerNotificationData({
      customerId,
      user,
    });
    const subscriptionName = product?.name || "Shelf Subscription";

    for (const email of emailsToNotify) {
      sendEmail({
        to: email,
        subject: "Your Shelf subscription is now active",
        text: subscriptionGrantedText({ customerName, subscriptionName }),
      });
    }
  }

  return OK();
}

// ─── Subscription Paused ───────────────────────────────────

export async function handleSubscriptionPaused(
  event: Stripe.Event,
  user: WebhookUser
) {
  const { subscription, customerId, tierId, productType, product } =
    await getDataFromStripeEvent(event);

  if (
    isAddonSubscription({
      tierId,
      productType,
      event,
      additionalData: { subscription },
    })
  ) {
    const organizationId = subscription?.metadata?.organizationId;
    if (product?.metadata?.addon_type === "audits" && organizationId) {
      await handleAuditAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  const pausedSubscriptionIsHigherOrEqualTier = isHigherOrEqualTier(
    tierId as Sb.TierId,
    user.tierId
  );

  if (
    subscription.status === "paused" &&
    pausedSubscriptionIsHigherOrEqualTier
  ) {
    await updateUserByCustomerId(customerId, { tierId: "free" }, { event });

    // Only reset branding when downgrading from Plus (tier_1) to Free
    if (user.tierId === "tier_1") {
      await resetPersonalWorkspaceBranding(user.id);
    }
  }

  return OK();
}

// ─── Subscription Updated ──────────────────────────────────

export async function handleSubscriptionUpdated(
  event: Stripe.Event,
  user: WebhookUser
) {
  const { subscription, customerId, tierId, productType, product } =
    await getDataFromStripeEvent(event);

  if (
    isAddonSubscription({
      tierId,
      productType,
      event,
      additionalData: { subscription },
    })
  ) {
    const organizationId = subscription?.metadata?.organizationId;
    if (product?.metadata?.addon_type === "audits" && organizationId) {
      await handleAuditAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  const newSubscriptionIsHigherTier = isHigherTier(
    tierId as Sb.TierId,
    user.tierId
  );

  if (subscription.status === "active" && newSubscriptionIsHigherTier) {
    await updateUserByCustomerId(customerId, { tierId }, { event });
  }

  return OK();
}

// ─── Subscription Deleted ──────────────────────────────────

export async function handleSubscriptionDeleted(
  event: Stripe.Event,
  user: WebhookUser
) {
  const { subscription, customerId, tierId, productType, product } =
    await getDataFromStripeEvent(event);

  if (isAddonSubscription({ tierId, productType, event })) {
    const organizationId = subscription?.metadata?.organizationId;
    // Skip audit disable when this cancellation is part of a subscription
    // transfer — the new subscription's create webhook already enabled audits.
    const isTransferCancellation =
      !!subscription?.metadata?.transferred_to_subscription;
    if (
      product?.metadata?.addon_type === "audits" &&
      organizationId &&
      !isTransferCancellation
    ) {
      await handleAuditAddonWebhook({
        eventType: event.type,
        organizationId,
      });
    }
    return OK();
  }

  const deletedSubscriptionIsHigherOrEqualTier = isHigherOrEqualTier(
    tierId as Sb.TierId,
    user.tierId
  );

  if (deletedSubscriptionIsHigherOrEqualTier) {
    await updateUserByCustomerId(customerId, { tierId: "free" }, { event });

    // Only reset branding when downgrading from Plus (tier_1) to Free
    if (user.tierId === "tier_1") {
      await resetPersonalWorkspaceBranding(user.id);
    }
  }

  return OK();
}

// ─── Invoice Payment Failed ────────────────────────────────

export async function handleInvoicePaymentFailed(
  event: Stripe.Event,
  user: WebhookUser,
  customerId: string
) {
  const failedInvoice = event.data.object as Stripe.Invoice;

  await updateUserByCustomerId(
    customerId,
    { hasUnpaidInvoice: true },
    { event }
  );

  // If user was warned about missing payment method and payment fails,
  // pause the subscription immediately instead of waiting for Stripe's retry logic.
  // This prevents service without payment method from continuing through retry period.
  const failedSubscriptionId =
    failedInvoice.parent?.subscription_details?.subscription;
  if (user.warnForNoPaymentMethod && failedSubscriptionId) {
    await stripe.subscriptions.update(failedSubscriptionId as string, {
      pause_collection: {
        behavior: "void", // Void upcoming invoices while paused
      },
    });
    // Note: This will trigger customer.subscription.paused webhook
    // which handles tier downgrade
  }

  sendAdminInvoiceEmail({
    user,
    eventType: event.type,
    invoiceId: failedInvoice.id,
    subject: `Unpaid invoice: ${user.email}`,
  });

  // Send user notification (deduplicated)
  const { emailsToNotify, customerName, subscriptionName, amountDue, dueDate } =
    await getInvoiceNotificationData({
      customerId,
      invoice: failedInvoice,
      user,
    });

  for (const email of emailsToNotify) {
    sendEmail({
      to: email,
      subject: "Action needed: Payment issue with your Shelf subscription",
      text: unpaidInvoiceUserText({
        customerEmail: email,
        customerName,
        subscriptionName,
        amountDue,
        dueDate,
      }),
    });
  }

  return OK();
}

// ─── Invoice Paid ──────────────────────────────────────────

export async function handleInvoicePaid(
  event: Stripe.Event,
  user: WebhookUser,
  customerId: string
) {
  const paidInvoice = event.data.object as Stripe.Invoice;

  // Clear unpaid invoice flag and missing payment method warning
  // (paying an invoice proves they have a working payment method)
  await updateUserByCustomerId(
    customerId,
    { hasUnpaidInvoice: false, warnForNoPaymentMethod: false },
    { event }
  );

  /**
   * Safety net: Update user tier when a subscription invoice is paid.
   *
   * In most cases, the tier is already set by `customer.subscription.created`.
   * However, this serves as a fallback for edge cases like:
   * - Subscription created in "incomplete" state that only activates after payment
   * - If `customer.subscription.created` event was missed or failed
   * - Any other scenario where the tier wasn't properly set on creation
   *
   * Iterates ALL subscription items to handle bundled subscriptions
   * (tier + audit addon in a single subscription).
   */
  const subscriptionId = paidInvoice.parent?.subscription_details?.subscription;
  if (subscriptionId) {
    const subscription = await fetchStripeSubscription(
      subscriptionId as string
    );

    if (subscription.status === "active") {
      // Iterate all items to find tier and addon products
      for (const item of subscription.items.data) {
        const product = item.plan.product as Stripe.Product;
        const tierId = product?.metadata?.shelf_tier;
        const productType = product?.metadata?.product_type;

        // Handle audit add-on invoice paid as safety net
        if (
          productType === "addon" &&
          product?.metadata?.addon_type === "audits"
        ) {
          const organizationId = subscription?.metadata?.organizationId;
          if (organizationId) {
            await sbDb
              .from("Organization")
              .update({ auditsEnabled: true })
              .eq("id", organizationId);
          }
        }

        // Update tier for non-addon products
        if (tierId && productType !== "addon") {
          if (isHigherOrEqualTier(tierId as Sb.TierId, user.tierId)) {
            await updateUserByCustomerId(customerId, { tierId }, { event });
          }
        }
      }
    }
  }

  // Only send admin notification for actual paid invoices (not $0 trial invoices)
  if (paidInvoice.amount_paid > 0) {
    sendAdminInvoiceEmail({
      user,
      eventType: event.type,
      invoiceId: paidInvoice.id,
      subject: `Invoice resolved: ${user.email}`,
    });
  }

  return OK();
}

// ─── Invoice Resolved (voided / marked_uncollectible) ──────

export async function handleInvoiceResolved(
  event: Stripe.Event,
  user: WebhookUser,
  customerId: string
) {
  const resolvedInvoice = event.data.object as Stripe.Invoice;

  await updateUserByCustomerId(
    customerId,
    { hasUnpaidInvoice: false },
    { event }
  );

  sendAdminInvoiceEmail({
    user,
    eventType: event.type,
    invoiceId: resolvedInvoice.id,
    subject: `Invoice resolved: ${user.email}`,
  });

  return OK();
}

// ─── Invoice Overdue ───────────────────────────────────────

export async function handleInvoiceOverdue(
  event: Stripe.Event,
  user: WebhookUser,
  customerId: string
) {
  const overdueInvoice = event.data.object as Stripe.Invoice;

  // Mark user as having unpaid invoice
  await updateUserByCustomerId(
    customerId,
    { hasUnpaidInvoice: true },
    { event }
  );

  sendAdminInvoiceEmail({
    user,
    eventType: event.type,
    invoiceId: overdueInvoice.id,
    subject: `Invoice overdue: ${user.email}`,
  });

  // Send user notification (deduplicated)
  const { emailsToNotify, customerName, subscriptionName, amountDue, dueDate } =
    await getInvoiceNotificationData({
      customerId,
      invoice: overdueInvoice,
      user,
    });

  for (const email of emailsToNotify) {
    sendEmail({
      to: email,
      subject: "Action needed: Your Shelf invoice is overdue",
      text: unpaidInvoiceUserText({
        customerEmail: email,
        customerName,
        subscriptionName,
        amountDue,
        dueDate,
      }),
    });
  }

  // Downgrade user tier if invoice is for a subscription with a tier
  const subscriptionId =
    overdueInvoice.parent?.subscription_details?.subscription;
  if (subscriptionId) {
    const subscription = await fetchStripeSubscription(
      subscriptionId as string
    );
    const product = subscription.items.data[0].plan.product as Stripe.Product;
    const tierId = product?.metadata?.shelf_tier;
    const productType = product?.metadata?.product_type;

    // Only downgrade for non-addon subscription products with a tier
    if (tierId && productType !== "addon") {
      if (isHigherOrEqualTier(tierId as Sb.TierId, user.tierId)) {
        await updateUserByCustomerId(customerId, { tierId: "free" }, { event });

        // Reset branding when downgrading from Plus (tier_1) to Free
        if (user.tierId === "tier_1") {
          await resetPersonalWorkspaceBranding(user.id);
        }
      }
    }
  }

  return OK();
}

// ─── Trial Will End ────────────────────────────────────────

export async function handleTrialWillEnd(
  event: Stripe.Event,
  user: WebhookUser
) {
  const { tierId, subscription, productType, product, customerId } =
    await getDataFromStripeEvent(event);

  if (
    isAddonSubscription({
      tierId,
      productType,
      event,
      additionalData: { subscription },
    })
  ) {
    // Send trial ending email for audit add-on
    if (subscription.trial_end && product?.metadata?.addon_type === "audits") {
      const hasPaymentMethod = await customerHasPaymentMethod(customerId);
      void sendAuditTrialEndsSoonEmail({
        firstName: user.firstName,
        email: user.email,
        hasPaymentMethod,
        trialEndDate: new Date(subscription.trial_end * 1000),
      });
    }
    return OK();
  }

  const isTrialSubscription =
    subscription.trial_end && subscription.trial_start;

  if (isTrialSubscription) {
    sendEmail({
      to: user.email,
      subject: "Your shelf.nu free trial is ending soon",
      text: trialEndsSoonEmailText({
        firstName: user?.firstName ?? null,
        trialEndDate: new Date((subscription.trial_end as number) * 1000),
      }),
    });
  }

  return OK();
}

// ─── Payment Method Attached ───────────────────────────────

export async function handlePaymentMethodAttached(
  _event: Stripe.Event,
  _user: WebhookUser,
  customerId: string
) {
  // Clear the warning flag when user adds a payment method
  await updateUserByCustomerId(
    customerId,
    { warnForNoPaymentMethod: false },
    { event: _event }
  );

  return OK();
}

// ─── Payment Method Detached ───────────────────────────────

export async function handlePaymentMethodDetached(
  _event: Stripe.Event,
  _user: WebhookUser,
  customerId: string
) {
  // When user removes a payment method, check if they still have one
  // If they have an active subscription but no payment method, warn them
  const hasPaymentMethod = await customerHasPaymentMethod(customerId);

  if (!hasPaymentMethod) {
    const customer = (await getStripeCustomer(
      customerId
    )) as CustomerWithSubscriptions;
    const activeSubscription = getCustomerActiveSubscription({ customer });

    if (activeSubscription) {
      await updateUserByCustomerId(
        customerId,
        { warnForNoPaymentMethod: true },
        { event: _event }
      );
    }
  }

  return OK();
}
