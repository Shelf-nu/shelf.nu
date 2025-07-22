import { TierId } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { trialEndsSoonText } from "~/emails/stripe/trial-ends-soon";
import { sendTeamTrialWelcomeEmail } from "~/emails/stripe/welcome-to-trial";
import { CUSTOM_INSTALL_CUSTOMERS } from "~/utils/env";
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
        include: {
          tier: true,
          customTierLimit: true,
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

        if (!tierId) {
          throw new ShelfError({
            cause: null,
            message: "No tier ID found",
            additionalData: { event, subscription },
            label: "Stripe webhook",
            status: 500,
          });
        }

        /** Update the user's tier in the database */
        await db.user
          .update({
            where: { customerId },
            data: {
              tierId: tierId as TierId,
            },
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
        const { subscription, customerId, tierId } =
          await getDataFromStripeEvent(event);

        if (!tierId) {
          throw new ShelfError({
            cause: null,
            message: "No tier ID found",
            additionalData: { event, subscription },
            label: "Stripe webhook",
            status: 500,
          });
        }

        /** Check if its a trial subscription */
        const isTrialSubscription =
          !!subscription.trial_end && !!subscription.trial_start;

        if (isTrialSubscription) {
          /** WHen its a trial subscription, update the tier of the user */
          const user = await db.user
            .update({
              where: { customerId },
              data: {
                tierId: tierId as TierId,
                usedFreeTrial: true,
              },
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
            email: user.email,
          });
        }

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.paused": {
        /** THis typically handles expiring of subscription */
        const { subscription, customerId, tierId } =
          await getDataFromStripeEvent(event);

        if (!tierId) {
          throw new ShelfError({
            cause: null,
            message: "No tier ID found",
            additionalData: { event, subscription },
            label: "Stripe webhook",
            status: 500,
          });
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

      case "customer.subscription.updated": {
        const { subscription, customerId, tierId } =
          await getDataFromStripeEvent(event);

        if (!tierId) {
          throw new ShelfError({
            cause: null,
            message: "No tier ID found",
            additionalData: { event },
            label: "Stripe webhook",
            status: 500,
          });
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
        // Occurs whenever a customer’s subscription ends.
        const { customerId, tierId } = await getDataFromStripeEvent(event);

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
        }

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.trial_will_end": {
        // Occurs three days before the trial period of a subscription is scheduled to end.
        const { tierId, subscription } = await getDataFromStripeEvent(event);

        if (!tierId) {
          throw new ShelfError({
            cause: null,
            message: "No tier ID found",
            additionalData: { event, subscription },
            label: "Stripe webhook",
            status: 500,
          });
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
    return json(error(reason), { status: reason.status });
  }
}
