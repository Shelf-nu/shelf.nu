import { TierId } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type Stripe from "stripe";
import { db } from "~/database";
import { trialEndsSoonText } from "~/emails/stripe/trial-ends-soon";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import {
  fetchStripeSubscription,
  getDataFromStripeEvent,
  stripe,
} from "~/utils/stripe.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature") as string;
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      payload,
      sig,
      process.env.STRIPE_WEBHOOK_ENDPOINT_SECRET
    );
    // Handle the event
    // Don't forget to enable the events in the Stripe dashboard
    switch (event.type) {
      case "checkout.session.completed": {
        // Here we need to update the user's tier in the database based on the subscription they created

        /** Get the subscriptionId from the session object */
        const { subscription: subscriptionId } = event.data
          .object as Stripe.Checkout.Session;

        /** if it doesnt exist, throw an error */
        if (!subscriptionId) throw new Error("No subscription ID found");

        const subscription = await fetchStripeSubscription(
          subscriptionId as string
        );
        /** Get the product */
        const product = subscription.items.data[0].plan
          .product as Stripe.Product;
        /* get the string with the customer id */
        const customerId = subscription.customer as string;
        const tierId = product?.metadata?.shelf_tier;
        if (!tierId) throw new Error("No tier ID found");
        /** Update the user's tier in the database */
        await db.user.update({
          where: { customerId },
          data: {
            tierId: tierId as TierId,
          },
        });

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.created": {
        const { subscription, customerId, tierId } =
          await getDataFromStripeEvent(event);

        if (!tierId) throw new Error("No tier ID found");

        /** Check if its a trial subscription */
        const isTrialSubscription =
          !!subscription.trial_end && !!subscription.trial_start;

        if (isTrialSubscription) {
          /** WHen its a trial subscription, update the tier of the user */
          await db.user.update({
            where: { customerId },
            data: {
              tierId: tierId as TierId,
            },
          });
        }

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.paused": {
        /** THis typpically handles expiring of subsciption */
        const { subscription, customerId, tierId } =
          await getDataFromStripeEvent(event);

        if (!tierId) throw new Error("No tier ID found");

        /** When its a trial subscription, update the tier of the user
         * In that case we just set it back to free
         */
        if (subscription.status === "paused") {
          await db.user.update({
            where: { customerId },
            data: {
              tierId: "free",
            },
          });
        }

        return new Response(null, { status: 200 });
      }

      case "customer.subscription.updated": {
        const { customerId, tierId } = await getDataFromStripeEvent(event);

        if (!tierId) throw new Error("No tier ID found");
        /** Update the user's tier in the database */
        await db.user.update({
          where: { customerId },
          data: {
            tierId: tierId as TierId,
          },
        });
        return new Response(null, { status: 200 });
      }

      case "customer.subscription.deleted": {
        // Occurs whenever a customer’s subscription ends.
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        await db.user.update({
          where: { customerId },
          data: {
            tierId: TierId.free,
          },
        });
        return new Response(null, { status: 200 });
      }

      case "customer.subscription.trial_will_end": {
        // Occurs three days before the trial period of a subscription is scheduled to end.
        const { customerId, tierId, subscription } =
          await getDataFromStripeEvent(event);

        if (!tierId) throw new ShelfStackError({ message: "No tier ID found" });
        /** Check if its a trial subscription */
        const isTrialSubscription =
          subscription.trial_end && subscription.trial_start;

        if (isTrialSubscription) {
          const user = await db.user.findUnique({
            where: { customerId },
          });
          if (!user) throw new ShelfStackError({ message: "No user found" });

          await sendEmail({
            to: "carlos@shelf.nu",
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
    }
  } catch (err: any) {
    throw json({ errors: [{ message: err.message }] }, 400);
  }
  return new Response(null, { status: 200 });
};
