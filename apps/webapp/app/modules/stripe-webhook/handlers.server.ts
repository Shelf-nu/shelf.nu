import { TierId } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { sendAuditTrialEndsSoonEmail } from "~/emails/stripe/audit-trial-ends-soon";
import { sendBarcodeTrialEndsSoonEmail } from "~/emails/stripe/barcode-trial-ends-soon";
import { subscriptionGrantedText } from "~/emails/stripe/subscription-granted";
import { sendTrialEndsSoonEmail } from "~/emails/stripe/trial-ends-soon";
import { unpaidInvoiceUserText } from "~/emails/stripe/unpaid-invoice";
import { sendTeamTrialWelcomeEmail } from "~/emails/stripe/welcome-to-trial";
import { scheduleTrialEndsTomorrowEmail } from "~/modules/addon-trial/scheduler.server";
import { handleAuditAddonWebhook } from "~/modules/audit/addon.server";
import { handleBarcodeAddonWebhook } from "~/modules/barcode/addon.server";
import { resetPersonalWorkspaceBranding } from "~/modules/organization/service.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
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
    if (product?.metadata?.addon_type === "barcodes" && organizationId) {
      await handleBarcodeAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  await db.user
    .update({
      where: { customerId },
      data: { tierId: tierId as TierId },
      select: { id: true },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to update user tier",
        additionalData: { customerId, tierId, event },
        label: "Stripe webhook",
        status: 500,
      });
    });

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
    if (product?.metadata?.addon_type === "barcodes" && organizationId) {
      await handleBarcodeAddonWebhook({
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
    const trialUser = await db.user
      .update({
        where: { customerId },
        data: {
          tierId: tierId as TierId,
          usedFreeTrial: true,
        },
        select: { email: true, firstName: true, displayName: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to update user tier",
          additionalData: { customerId, tierId, event },
          label: "Stripe webhook",
          status: 500,
        });
      });

    void sendTeamTrialWelcomeEmail({
      email: trialUser.email,
      firstName: trialUser.firstName,
    });
  } else if (isTransferredSubscription) {
    // Transferred subscription: update tier but skip welcome emails
    // and don't set usedFreeTrial (already handled in transferOwnership)
    await db.user
      .update({
        where: { customerId },
        data: { tierId: tierId as TierId },
        select: { id: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to update user tier",
          additionalData: { customerId, tierId, event },
          label: "Stripe webhook",
          status: 500,
        });
      });
  } else {
    await db.user
      .update({
        where: { customerId },
        data: { tierId: tierId as TierId },
        select: { id: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to update user tier",
          additionalData: { customerId, tierId, event },
          label: "Stripe webhook",
          status: 500,
        });
      });

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
    if (product?.metadata?.addon_type === "barcodes" && organizationId) {
      await handleBarcodeAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  const pausedSubscriptionIsHigherOrEqualTier = isHigherOrEqualTier(
    tierId as TierId,
    user.tierId
  );

  if (
    subscription.status === "paused" &&
    pausedSubscriptionIsHigherOrEqualTier
  ) {
    await db.user
      .update({
        where: { customerId },
        data: { tierId: "free" },
        select: { id: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to update user tier",
          additionalData: { customerId, tierId, event },
          label: "Stripe webhook",
          status: 500,
        });
      });

    // Only reset branding when downgrading from Plus (tier_1) to Free
    if (user.tierId === TierId.tier_1) {
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
    if (product?.metadata?.addon_type === "barcodes" && organizationId) {
      await handleBarcodeAddonWebhook({
        eventType: event.type,
        subscription,
        organizationId,
      });
    }
    return OK();
  }

  const newSubscriptionIsHigherTier = isHigherTier(
    tierId as TierId,
    user.tierId
  );

  if (subscription.status === "active" && newSubscriptionIsHigherTier) {
    await db.user
      .update({
        where: { customerId },
        data: { tierId: tierId as TierId },
        select: { id: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to update user tier",
          additionalData: { customerId, tierId, event },
          label: "Stripe webhook",
          status: 500,
        });
      });
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
    // Skip addon disable when this cancellation is part of a subscription
    // transfer — the new subscription's create webhook already enabled the addon.
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
    if (
      product?.metadata?.addon_type === "barcodes" &&
      organizationId &&
      !isTransferCancellation
    ) {
      await handleBarcodeAddonWebhook({
        eventType: event.type,
        organizationId,
      });
    }
    return OK();
  }

  const deletedSubscriptionIsHigherOrEqualTier = isHigherOrEqualTier(
    tierId as TierId,
    user.tierId
  );

  if (deletedSubscriptionIsHigherOrEqualTier) {
    await db.user
      .update({
        where: { customerId },
        data: { tierId: TierId.free },
        select: { id: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to delete user subscription",
          additionalData: { customerId, event },
          label: "Stripe webhook",
          status: 500,
        });
      });

    // Only reset branding when downgrading from Plus (tier_1) to Free
    if (user.tierId === TierId.tier_1) {
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

  await db.user
    .update({
      where: { customerId },
      data: { hasUnpaidInvoice: true },
      select: { id: true },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to update unpaid invoice flag",
        additionalData: { customerId, event },
        label: "Stripe webhook",
        status: 500,
      });
    });

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
  await db.user
    .update({
      where: { customerId },
      data: { hasUnpaidInvoice: false, warnForNoPaymentMethod: false },
      select: { id: true },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to update unpaid invoice flag",
        additionalData: { customerId, event },
        label: "Stripe webhook",
        status: 500,
      });
    });

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
            await db.organization.update({
              where: { id: organizationId },
              data: { auditsEnabled: true },
              select: { id: true },
            });
          }
        }

        // Handle barcode add-on invoice paid as safety net
        if (
          productType === "addon" &&
          product?.metadata?.addon_type === "barcodes"
        ) {
          const organizationId = subscription?.metadata?.organizationId;
          if (organizationId) {
            await db.organization.update({
              where: { id: organizationId },
              data: { barcodesEnabled: true },
              select: { id: true },
            });
          }
        }

        // Update tier for non-addon products
        if (tierId && productType !== "addon") {
          if (isHigherOrEqualTier(tierId as TierId, user.tierId)) {
            await db.user
              .update({
                where: { customerId },
                data: { tierId: tierId as TierId },
                select: { id: true },
              })
              .catch((cause) => {
                throw new ShelfError({
                  cause,
                  message: "Failed to update user tier from paid invoice",
                  additionalData: { customerId, tierId, event },
                  label: "Stripe webhook",
                  status: 500,
                });
              });
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

  await db.user
    .update({
      where: { customerId },
      data: { hasUnpaidInvoice: false },
      select: { id: true },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to update unpaid invoice flag",
        additionalData: { customerId, event },
        label: "Stripe webhook",
        status: 500,
      });
    });

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
  await db.user
    .update({
      where: { customerId },
      data: { hasUnpaidInvoice: true },
      select: { id: true },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to update unpaid invoice flag",
        additionalData: { customerId, event },
        label: "Stripe webhook",
        status: 500,
      });
    });

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
      if (isHigherOrEqualTier(tierId as TierId, user.tierId)) {
        await db.user
          .update({
            where: { customerId },
            data: { tierId: TierId.free },
            select: { id: true },
          })
          .catch((cause) => {
            throw new ShelfError({
              cause,
              message: "Failed to downgrade user tier for overdue invoice",
              additionalData: { customerId, tierId, event },
              label: "Stripe webhook",
              status: 500,
            });
          });

        // Reset branding when downgrading from Plus (tier_1) to Free
        if (user.tierId === TierId.tier_1) {
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
    const addonType = product?.metadata?.addon_type as
      | "audits"
      | "barcodes"
      | undefined;

    if (subscription.trial_end && addonType) {
      const hasPaymentMethod = await customerHasPaymentMethod(customerId);
      const trialEndDate = new Date(subscription.trial_end * 1000);

      // Send 3-day warning email
      if (addonType === "audits") {
        void sendAuditTrialEndsSoonEmail({
          firstName: user.firstName,
          email: user.email,
          hasPaymentMethod,
          trialEndDate,
        });
      } else {
        void sendBarcodeTrialEndsSoonEmail({
          firstName: user.firstName,
          email: user.email,
          hasPaymentMethod,
          trialEndDate,
        });
      }

      // Schedule 1-day warning email (only for users with payment method)
      if (hasPaymentMethod) {
        const oneDayBefore = new Date(
          trialEndDate.getTime() - 24 * 60 * 60 * 1000
        );
        scheduleTrialEndsTomorrowEmail({
          data: {
            addonType,
            userId: user.id,
            email: user.email,
            firstName: user.firstName,
            customerId,
            subscriptionId: subscription.id,
            trialEndDate: trialEndDate.toISOString(),
          },
          when: oneDayBefore,
        }).catch((cause) => {
          // Log but don't fail the webhook — the 1-day email is best-effort
          Logger.error(
            new ShelfError({
              cause,
              message: "Failed to schedule trial ends tomorrow email",
              additionalData: {
                addonType,
                subscriptionId: subscription.id,
              },
              label: "Stripe",
            })
          );
        });
      }
    }
    return OK();
  }

  const isTrialSubscription =
    subscription.trial_end && subscription.trial_start;

  if (isTrialSubscription) {
    const hasPaymentMethod = await customerHasPaymentMethod(customerId);
    void sendTrialEndsSoonEmail({
      firstName: user.firstName,
      email: user.email,
      hasPaymentMethod,
      planName: product?.name || "Shelf",
      trialEndDate: new Date((subscription.trial_end as number) * 1000),
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
  await db.user
    .update({
      where: { customerId },
      data: { warnForNoPaymentMethod: false },
      select: { id: true },
    })
    .catch((cause) => {
      throw new ShelfError({
        cause,
        message: "Failed to clear missing payment method warning",
        additionalData: { customerId, event: _event },
        label: "Stripe webhook",
        status: 500,
      });
    });

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
      await db.user
        .update({
          where: { customerId },
          data: { warnForNoPaymentMethod: true },
          select: { id: true },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Failed to set missing payment method warning",
            additionalData: { customerId, event: _event },
            label: "Stripe webhook",
            status: 500,
          });
        });
    }
  }

  return OK();
}
