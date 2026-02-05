import { TierId } from "@prisma/client";
import { data, type ActionFunctionArgs } from "react-router";
import type Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { subscriptionGrantedText } from "~/emails/stripe/subscription-granted";
import { trialEndsSoonText } from "~/emails/stripe/trial-ends-soon";
import {
  unpaidInvoiceAdminText,
  unpaidInvoiceUserText,
} from "~/emails/stripe/unpaid-invoice";
import { sendTeamTrialWelcomeEmail } from "~/emails/stripe/welcome-to-trial";
import { resetPersonalWorkspaceBranding } from "~/modules/organization/service.server";
import { ADMIN_EMAIL, CUSTOM_INSTALL_CUSTOMERS } from "~/utils/env";
import { ShelfError, makeShelfError } from "~/utils/error";
import { error } from "~/utils/http.server";
import {
  fetchStripeSubscription,
  getDataFromStripeEvent,
  stripe,
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
    const eventData = event.data.object as { customer: string };
    const customerId = eventData.customer;
    const user = await db.user
      .findFirstOrThrow({
        where: { customerId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          tierId: true,
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
              select: { email: true },
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

          // Send email notification to user about their new subscription
          const stripeCustomer = await stripe.customers.retrieve(customerId);
          const stripeEmail =
            stripeCustomer && !stripeCustomer.deleted
              ? stripeCustomer.email
              : null;
          const stripeName =
            stripeCustomer && !stripeCustomer.deleted
              ? stripeCustomer.name
              : null;

          // Get the product name (product is already fetched in getDataFromStripeEvent)
          const subscriptionName = product?.name || "Shelf Subscription";

          // Collect unique emails to send to (Stripe email + Shelf user email if different)
          const emailsToNotify = new Set<string>();
          if (stripeEmail) emailsToNotify.add(stripeEmail.toLowerCase());
          if (user.email) emailsToNotify.add(user.email.toLowerCase());

          for (const email of emailsToNotify) {
            sendEmail({
              to: email,
              subject: "Your Shelf subscription is now active",
              text: subscriptionGrantedText({
                customerName: stripeName || user.firstName,
                subscriptionName,
              }),
            });
          }
        }

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.paused": {
        /** THis typically handles expiring of subscription */
        const { subscription, customerId, tierId, productType } =
          await getDataFromStripeEvent(event);

        if (
          isAddonSubscription({
            tierId,
            productType,
            event,
            additionalData: { subscription },
          })
        ) {
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
        const { subscription, customerId, tierId, productType } =
          await getDataFromStripeEvent(event);

        if (
          isAddonSubscription({
            tierId,
            productType,
            event,
            additionalData: { subscription },
          })
        ) {
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
        const { customerId, tierId, productType } =
          await getDataFromStripeEvent(event);

        if (isAddonSubscription({ tierId, productType, event })) {
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

        // Send user notification using email from Stripe (billing email may differ from Shelf account)
        const stripeCustomer = await stripe.customers.retrieve(customerId);
        if (stripeCustomer && !stripeCustomer.deleted && stripeCustomer.email) {
          // Get subscription details from the invoice
          const subscriptionName =
            failedInvoice.lines?.data?.[0]?.description || "Shelf Subscription";
          const amountDue = new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: failedInvoice.currency,
          }).format(failedInvoice.amount_due / 100);
          const dueDate = failedInvoice.due_date
            ? new Date(failedInvoice.due_date * 1000).toLocaleDateString(
                "en-US",
                {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }
              )
            : null;

          sendEmail({
            to: stripeCustomer.email,
            subject:
              "Action needed: Payment issue with your Shelf subscription",
            text: unpaidInvoiceUserText({
              customerEmail: stripeCustomer.email,
              customerName: stripeCustomer.name,
              subscriptionName,
              amountDue,
              dueDate,
            }),
          });
        }

        return new Response(null, { status: 200 });
      }

      case "invoice.paid": {
        const paidInvoice = event.data.object as Stripe.Invoice;

        // Clear unpaid invoice flag
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

        /**
         * Safety net: Update user tier when a subscription invoice is paid.
         *
         * In most cases, the tier is already set by `customer.subscription.created`.
         * However, this serves as a fallback for edge cases like:
         * - Subscription created in "incomplete" state that only activates after payment
         * - If `customer.subscription.created` event was missed or failed
         * - Any other scenario where the tier wasn't properly set on creation
         */
        if (paidInvoice.subscription) {
          const subscription = await fetchStripeSubscription(
            paidInvoice.subscription as string
          );

          if (subscription.status === "active") {
            const product = subscription.items.data[0].plan
              .product as Stripe.Product;
            const tierId = product?.metadata?.shelf_tier;
            const productType = product?.metadata?.product_type;

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
