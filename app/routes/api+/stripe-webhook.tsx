import type { TierId } from "@prisma/client";
import type { ActionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import type Stripe from "stripe";
import { db } from "~/database";
import { fetchStripeSubscription, stripe } from "~/utils/stripe.server";

export const action = async ({ request }: ActionArgs) => {
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
      }

      // case "customer.subscription.deleted": {
      //   //Not sure what we have to do here. Subscriptions just expire, not sure how a user can delete their subscription
      //   console.log("customer.subscription.deleted", event.data);
      // }

      // case "product.updated": {
      //   // I believe this runs when the user updates/changes their subscription to a new product
      //   // Here we need to change the tier
      //   console.log("product.updated", event.data);

      //   // const { tierId, active, description, name } = await parseData(
      //   //   event.data.object,
      //   //   z
      //   //     .object({
      //   //       id: z.nativeEnum(TierId),
      //   //       active: z.boolean(),
      //   //       name: z.string(),
      //   //       description: z.string().nullable(),
      //   //     })
      //   //     .transform(({ id: tierId, active, name, description }) => ({
      //   //       tierId,
      //   //       active,
      //   //       name,
      //   //       description,x
      //   //     })),
      //   //   `${event.type} payload is malformed`
      //   // );

      //   // const updatedTier = await updateTier(tierId, {
      //   //   active,
      //   //   description,
      //   //   name,
      //   // });

      //   // return response.ok(updatedTier, { authSession: null });
      // }
    }
  } catch (err: any) {
    console.log(err);
    throw json({ errors: [{ message: err.message }] }, 400);
  }
  // console.log("event", event);
  return new Response(null, { status: 200 });
};
