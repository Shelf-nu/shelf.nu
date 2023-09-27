import { TierId } from "@prisma/client";
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type Stripe from "stripe";
import { db } from "~/database";
import { fetchStripeSubscription, stripe } from "~/utils/stripe.server";

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

      case "customer.subscription.updated": {
        // Here we need to update the user's tier in the database based on the subscription they created
        const subscription = event.data.object as Stripe.Subscription;

        /** Get the product */
        const productId = subscription.items.data[0].plan.product as string;
        const product = await stripe.products.retrieve(productId);
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
    }
  } catch (err: any) {
    throw json({ errors: [{ message: err.message }] }, 400);
  }
  return new Response(null, { status: 200 });
};
