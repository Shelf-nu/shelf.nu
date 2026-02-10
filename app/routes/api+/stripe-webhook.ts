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

import { TierId } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import type Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { sendSubscriptionGrantedEmail } from "~/emails/stripe/subscription-granted";
import { trialEndsSoonText } from "~/emails/stripe/trial-ends-soon";
import {
  unpaidInvoiceAdminText,
  sendUnpaidInvoiceUserEmail,
} from "~/emails/stripe/unpaid-invoice";
import { sendTeamTrialWelcomeEmail } from "~/emails/stripe/welcome-to-trial";
import { handleAuditAddonWebhook } from "~/modules/audit/addon.server";
import { resetPersonalWorkspaceBranding } from "~/modules/organization/service.server";
import { ADMIN_EMAIL, CUSTOM_INSTALL_CUSTOMERS } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
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

const subscriptionTiersPriority: Record<TierId, number> = {
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
function isAddonSubscription({
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

export async function action({ request }: ActionFunctionArgs) {
  try {
    const payload = await request.text();
    const sig = request.headers.get("stripe-signature") as string;

    const event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET
    );

    const customInstallUsers = (CUSTOM_INSTALL_CUSTOMERS ?? "").split(",");
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
        return new Response(null, { status: 200 });
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
        where: { customerId: customerId as string },
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

    /** We don't have to do anything in case if the user is custom install. */
    if (customInstallUsers.includes(customerId)) {
      return new Response(null, { status: 200 });
    }

    // Handle the event
    // Don't forget to enable the events in the Stripe dashboard
    switch (event.type) {
      case "checkout.session.completed": {
        // Here we need to update the user's tier in the database based on the subscription they created
        /** Get the subscriptionId from the session object */
        const { subscription: subscriptionId } = event.data
          .object as Stripe.Checkout.Session;

        /** if it doesnt exist, throw an error */
        if (!subscriptionId) {
          throw new ShelfError({
            cause: null,
            message: "No subscription ID found",
            additionalData: { event },
            label: "Stripe webhook",
            status: 500,
          });
        }

        const subscription = await fetchStripeSubscription(
          subscriptionId as string
        );

        /** Get the product */
        const product = subscription.items.data[0].plan
          .product as Stripe.Product;

        /* get the string with the customer id */
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
          if (product?.metadata?.addon_type === "audits") {
            await handleAuditAddonWebhook({
              eventType: event.type,
              subscription,
              customerId,
            });
          }
          return new Response(null, { status: 200 });
        }

        /** Update the user's tier in the database */
        await db.user
          .update({
            where: { customerId },
            data: {
              tierId: tierId as TierId,
            },
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

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.created": {
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
          if (product?.metadata?.addon_type === "audits") {
            await handleAuditAddonWebhook({
              eventType: event.type,
              subscription,
              customerId,
            });
          }
          return new Response(null, { status: 200 });
        }

        /** Check if its a trial subscription */
        const isTrialSubscription =
          !!subscription.trial_end && !!subscription.trial_start;

        if (isTrialSubscription) {
          /** When its a trial subscription, update the tier and mark trial as used */
          const trialUser = await db.user
            .update({
              where: { customerId },
              data: {
                tierId: tierId as TierId,
                usedFreeTrial: true,
              },
              select: { email: true, firstName: true },
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

          /** Send the TRIAL welcome email with instructions */
          void sendTeamTrialWelcomeEmail({
            firstName: trialUser.firstName,
            email: trialUser.email,
          });
        } else {
          /**
           * For non-trial subscriptions (e.g., admin manually created subscription),
           * update the tier immediately without waiting for invoice payment
           */
          await db.user
            .update({
              where: { customerId },
              data: {
                tierId: tierId as TierId,
              },
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

          // Send email notification to user about their new subscription (deduplicated)
          const { emailsToNotify, customerName } =
            await getCustomerNotificationData({ customerId, user });

          // Get the product name (product is already fetched in getDataFromStripeEvent)
          const subscriptionName = product?.name || "Shelf Subscription";

          for (const email of emailsToNotify) {
            void sendSubscriptionGrantedEmail({
              email,
              customerName,
              subscriptionName,
            });
          }
        }

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.paused": {
        /** THis typically handles expiring of subscription */
        const {
          subscription,
          customerId,
          tierId,
          productType,
          product: pausedProduct,
        } = await getDataFromStripeEvent(event);

        if (
          isAddonSubscription({
            tierId,
            productType,
            event,
            additionalData: { subscription },
          })
        ) {
          if (pausedProduct?.metadata?.addon_type === "audits") {
            await handleAuditAddonWebhook({
              eventType: event.type,
              subscription,
              customerId,
            });
          }
          return new Response(null, { status: 200 });
        }

        /** Check whether the paused subscription is higher tier or equal tier and the current one and only then cancel */
        const pausedSubscriptionIsHigherTier =
          subscriptionTiersPriority[tierId as TierId] >=
          subscriptionTiersPriority[user.tierId];

        /** When its a trial subscription, update the tier of the user
         * In that case we just set it back to free
         */
        if (
          subscription.status === "paused" &&
          pausedSubscriptionIsHigherTier
        ) {
          await db.user
            .update({
              where: { customerId },
              data: {
                tierId: "free",
              },
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

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.updated": {
        const {
          subscription,
          customerId,
          tierId,
          productType,
          product: updatedProduct,
        } = await getDataFromStripeEvent(event);

        if (
          isAddonSubscription({
            tierId,
            productType,
            event,
            additionalData: { subscription },
          })
        ) {
          if (updatedProduct?.metadata?.addon_type === "audits") {
            await handleAuditAddonWebhook({
              eventType: event.type,
              subscription,
              customerId,
            });
          }
          return new Response(null, { status: 200 });
        }

        /** Update the user's tier in the database
         *
         * We only update the tier if the subscription is not paused
         * We only do it if the subscription is active because this event gets triggered when cancelling or pausing for example
         * We only do it if the subscription is higher tier than the current subscription they have. The tier order is free -> plus -> team
         */

        /** Check whether the new subscription is higher tier and the current one and only then cancel */
        const newSubscriptionIsHigherTier =
          subscriptionTiersPriority[tierId as TierId] >
          subscriptionTiersPriority[user.tierId];

        if (subscription.status === "active" && newSubscriptionIsHigherTier) {
          await db.user
            .update({
              where: { customerId },
              data: {
                tierId: tierId as TierId,
              },
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

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.deleted": {
        // Occurs whenever a customer's subscription ends.
        const {
          customerId,
          tierId,
          productType,
          product: deletedProduct,
        } = await getDataFromStripeEvent(event);

        if (isAddonSubscription({ tierId, productType, event })) {
          if (deletedProduct?.metadata?.addon_type === "audits") {
            await handleAuditAddonWebhook({
              eventType: event.type,
              customerId,
            });
          }
          return new Response(null, { status: 200 });
        }

        /** Check whether the deleted subscription is higher tier or equal tier and the current one and only then cancel */
        const deletedSubscriptionIsHigherTier =
          subscriptionTiersPriority[tierId as TierId] >=
          subscriptionTiersPriority[user.tierId];

        if (deletedSubscriptionIsHigherTier) {
          await db.user
            .update({
              where: { customerId },
              data: {
                tierId: TierId.free,
              },
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

        return new Response(null, { status: 200 });
      }

      case "invoice.payment_failed": {
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

        // Send admin notification
        if (ADMIN_EMAIL) {
          sendEmail({
            to: ADMIN_EMAIL,
            subject: `Unpaid invoice: ${user.email}`,
            text: unpaidInvoiceAdminText({
              user,
              eventType: event.type,
              invoiceId: failedInvoice.id,
            }),
          });
        }

        // Send user notification (deduplicated)
        const {
          emailsToNotify,
          customerName,
          subscriptionName,
          amountDue,
          dueDate,
        } = await getInvoiceNotificationData({
          customerId,
          invoice: failedInvoice,
          user,
        });

        for (const email of emailsToNotify) {
          void sendUnpaidInvoiceUserEmail({
            customerEmail: email,
            customerName,
            subscriptionName,
            amountDue,
            dueDate,
            subject:
              "Action needed: Payment issue with your Shelf subscription",
          });
        }

        return new Response(null, { status: 200 });
      }

      case "invoice.paid": {
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
         */
        // In Stripe API 2026-01-28, subscription moved to parent.subscription_details
        const subscriptionId =
          paidInvoice.parent?.subscription_details?.subscription;
        if (subscriptionId) {
          const subscription = await fetchStripeSubscription(
            subscriptionId as string
          );

          if (subscription.status === "active") {
            const product = subscription.items.data[0].plan
              .product as Stripe.Product;
            const tierId = product?.metadata?.shelf_tier;
            const productType = product?.metadata?.product_type;

            // Handle audit add-on invoice paid as safety net
            if (
              productType === "addon" &&
              product?.metadata?.addon_type === "audits"
            ) {
              await db.user.update({
                where: { customerId },
                data: { hasAuditAddon: true },
                select: { id: true },
              });
            }

            // Only update tier for non-addon products
            if (tierId && productType !== "addon") {
              const newSubscriptionIsHigherOrEqualTier =
                subscriptionTiersPriority[tierId as TierId] >=
                subscriptionTiersPriority[user.tierId];

              if (newSubscriptionIsHigherOrEqualTier) {
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

        // Only send admin notification for actual paid invoices (not $0 trial invoices)
        if (ADMIN_EMAIL && paidInvoice.amount_paid > 0) {
          sendEmail({
            to: ADMIN_EMAIL,
            subject: `Invoice resolved: ${user.email}`,
            text: unpaidInvoiceAdminText({
              user,
              eventType: event.type,
              invoiceId: paidInvoice.id,
            }),
          });
        }

        return new Response(null, { status: 200 });
      }

      case "invoice.voided":
      case "invoice.marked_uncollectible": {
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

        if (ADMIN_EMAIL) {
          sendEmail({
            to: ADMIN_EMAIL,
            subject: `Invoice resolved: ${user.email}`,
            text: unpaidInvoiceAdminText({
              user,
              eventType: event.type,
              invoiceId: resolvedInvoice.id,
            }),
          });
        }

        return new Response(null, { status: 200 });
      }

      case "invoice.overdue": {
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

        // Send admin notification
        if (ADMIN_EMAIL) {
          sendEmail({
            to: ADMIN_EMAIL,
            subject: `Invoice overdue: ${user.email}`,
            text: unpaidInvoiceAdminText({
              user,
              eventType: event.type,
              invoiceId: overdueInvoice.id,
            }),
          });
        }

        // Send user notification (deduplicated)
        const {
          emailsToNotify,
          customerName,
          subscriptionName,
          amountDue,
          dueDate,
        } = await getInvoiceNotificationData({
          customerId,
          invoice: overdueInvoice,
          user,
        });

        for (const email of emailsToNotify) {
          void sendUnpaidInvoiceUserEmail({
            customerEmail: email,
            customerName,
            subscriptionName,
            amountDue,
            dueDate,
            subject: "Action needed: Your Shelf invoice is overdue",
          });
        }

        // Downgrade user tier if invoice is for a subscription with a tier
        const subscriptionId =
          overdueInvoice.parent?.subscription_details?.subscription;
        if (subscriptionId) {
          const subscription = await fetchStripeSubscription(
            subscriptionId as string
          );
          const product = subscription.items.data[0].plan
            .product as Stripe.Product;
          const tierId = product?.metadata?.shelf_tier;
          const productType = product?.metadata?.product_type;

          // Only downgrade for non-addon subscription products with a tier
          if (tierId && productType !== "addon") {
            const subscriptionTierIsHigherOrEqual =
              subscriptionTiersPriority[tierId as TierId] >=
              subscriptionTiersPriority[user.tierId];

            if (subscriptionTierIsHigherOrEqual) {
              await db.user
                .update({
                  where: { customerId },
                  data: { tierId: TierId.free },
                  select: { id: true },
                })
                .catch((cause) => {
                  throw new ShelfError({
                    cause,
                    message:
                      "Failed to downgrade user tier for overdue invoice",
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

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.trial_will_end": {
        // Occurs three days before the trial period of a subscription is scheduled to end.
        const { tierId, subscription, productType } =
          await getDataFromStripeEvent(event);

        if (
          isAddonSubscription({
            tierId,
            productType,
            event,
            additionalData: { subscription },
          })
        ) {
          // For audit add-on trial ending, no special action needed
          // User still has access until trial actually ends
          return new Response(null, { status: 200 });
        }

        /** Check if its a trial subscription */
        const isTrialSubscription =
          subscription.trial_end && subscription.trial_start;

        if (isTrialSubscription) {
          sendEmail({
            to: user.email,
            subject: "Your shelf.nu free trial is ending soon",
            text: trialEndsSoonText({
              user: {
                firstName: user?.firstName ?? null,
                lastName: user?.lastName ?? null,
                email: user.email,
              },
              subscription,
            }),
          });
        }

        return new Response(null, { status: 200 });
      }

      case "payment_method.attached": {
        // Clear the warning flag when user adds a payment method
        // This is triggered when a user adds a payment method via the Stripe portal
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
              additionalData: { customerId, event },
              label: "Stripe webhook",
              status: 500,
            });
          });

        return new Response(null, { status: 200 });
      }

      case "payment_method.detached": {
        // When user removes a payment method, check if they still have one
        // If they have an active subscription but no payment method, warn them
        const hasPaymentMethod = await customerHasPaymentMethod(customerId);

        if (!hasPaymentMethod) {
          // Check if user has an active subscription
          const customer = (await getStripeCustomer(
            customerId
          )) as CustomerWithSubscriptions;
          const activeSubscription = getCustomerActiveSubscription({
            customer,
          });

          if (activeSubscription) {
            // User has subscription but no payment method - set warning
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
                  additionalData: { customerId, event },
                  label: "Stripe webhook",
                  status: 500,
                });
              });
          }
        }

        return new Response(null, { status: 200 });
      }

      default: {
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
    }
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}
