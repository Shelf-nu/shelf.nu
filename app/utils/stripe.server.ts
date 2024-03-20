import type { User } from "@prisma/client";
import Stripe from "stripe";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { config } from "~/config/shelf.config";
import { db } from "~/database";
import type { ErrorLabel } from ".";
import { ShelfError } from ".";
import { STRIPE_SECRET_KEY } from "./env";

const label: ErrorLabel = "Stripe";

export type CustomerWithSubscriptions = Stripe.Customer & {
  subscriptions: {
    has_more?: boolean;
    data: Stripe.Subscription[];
    total_count?: number;
  };
};

let _stripe: Stripe;

function getStripeServerClient() {
  if (
    !_stripe &&
    config.enablePremiumFeatures &&
    STRIPE_SECRET_KEY !== "" &&
    typeof STRIPE_SECRET_KEY === "string"
  ) {
    // Reference : https://github.com/stripe/stripe-node#usage-with-typescript
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
    });
  }
  return _stripe;
}

export const stripe = getStripeServerClient();

export type StripeEvent = ReturnType<Stripe["webhooks"]["constructEvent"]>;

// copied from (https://github.com/kentcdodds/kentcdodds.com/blob/ebb36d82009685e14da3d4b5d0ce4d577ed09c63/app/utils/misc.tsx#L229-L237)
export function getDomainUrl(request: Request) {
  const host =
    request.headers.get("X-Forwarded-Host") ?? request.headers.get("host");

  if (!host) {
    throw new ShelfError({
      cause: null,
      message: "Could not determine domain URL.",

      label,
    });
  }

  const protocol = host.includes("localhost") ? "http" : "https";

  return `${protocol}://${host}`;
}

/** Needed when user has no subscription and wants to buy their first one */
export async function createStripeCheckoutSession({
  priceId,
  userId,
  domainUrl,
  customerId,
}: {
  priceId: Stripe.Price["id"];
  userId: User["id"];
  domainUrl: string;
  customerId: string;
}): Promise<string> {
  try {
    if (!stripe) {
      throw new ShelfError({
        cause: null,
        message: "Stripe not initialized",
        additionalData: { priceId, userId, domainUrl, customerId },
        label,
      });
    }

    const SECRET_KEY = STRIPE_SECRET_KEY;

    if (!SECRET_KEY) {
      throw new ShelfError({
        cause: null,
        message: "Stripe secret key not found",
        additionalData: { priceId, userId, domainUrl, customerId },
        label,
      });
    }

    const lineItems = [
      {
        price: priceId,
        quantity: 1,
      },
    ];

    const { url } = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: `${domainUrl}/settings/subscription?success=true`,
      cancel_url: `${domainUrl}/settings/subscription?canceled=true`,
      client_reference_id: userId,
      customer: customerId,
    });

    if (!url) {
      throw new ShelfError({
        cause: null,
        message: "No url found in stripe checkout session response",
        additionalData: { priceId, userId, domainUrl, customerId },
        label,
      });
    }

    return url;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a checkout session. Please try again later or contact support.",
      additionalData: { priceId, userId, domainUrl, customerId },
      label,
    });
  }
}

/** Fetches prices and products from stripe */
export async function getStripePricesAndProducts() {
  try {
    const pricesResponse = await stripe.prices.list({
      active: true,
      expand: ["data.product"],
    });

    return groupPricesByInterval(pricesResponse.data as PriceWithProduct[]);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching prices and products from Stripe. Please try again later or contact support.",
      label,
    });
  }
}

// Function to group prices by recurring interval
function groupPricesByInterval(prices: PriceWithProduct[]) {
  const groupedPrices: { [key: string]: PriceWithProduct[] } = {};

  for (const price of prices) {
    if (price?.recurring?.interval) {
      const interval = price?.recurring?.interval;
      if (!groupedPrices[interval]) {
        groupedPrices[interval] = [];
      }
      groupedPrices[interval].push(price);
    }
  }

  // Sort the prices within each group by unit_amount
  for (const interval in groupedPrices) {
    if (groupedPrices.hasOwnProperty(interval)) {
      // @ts-ignore
      groupedPrices[interval].sort((a, b) => a.unit_amount - b.unit_amount);
    }
  }

  return groupedPrices;
}

/** Creates customer entry in stripe */
export const createStripeCustomer = async ({
  name,
  email,
  userId,
}: {
  name: string;
  email: User["email"];
  userId: User["id"];
}) => {
  try {
    if (config.enablePremiumFeatures && stripe) {
      const { id: customerId } = await stripe.customers.create({
        email,
        name,
        metadata: {
          userId,
        },
      });

      await db.user.update({
        where: { id: userId },
        data: { customerId },
      });

      return customerId;
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create customer in Stripe",
      additionalData: { email, name, userId },
      label,
    });
  }
};

/** Fetches customer based on ID */
export const getStripeCustomer = async (customerId: string) => {
  try {
    return await stripe.customers.retrieve(customerId, {
      expand: ["subscriptions"],
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to retrieve customer from Stripe",
      additionalData: { customerId },
      label,
    });
  }
};

export async function createBillingPortalSession({
  customerId,
}: {
  customerId: string;
}) {
  try {
    const { url } = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.SERVER_URL}/settings/subscription`,
    });

    return { url };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a billing portal session. Please try again later or contact support.",
      additionalData: { customerId },
      label,
    });
  }
}

export function getActiveProduct({
  prices,
  priceId,
}: {
  prices: {
    [key: string]: PriceWithProduct[];
  };
  priceId: string | null;
}) {
  if (!priceId) return null;
  // Check in the 'year' array
  for (const priceObj of prices.year) {
    if (priceObj.id === priceId) {
      return priceObj.product;
    }
  }

  // Check in the 'month' array
  for (const priceObj of prices.month) {
    if (priceObj.id === priceId) {
      return priceObj.product;
    }
  }

  // If no match is found, return null or throw an error, depending on your preference
  return null;
}

export function getCustomerActiveSubscription({
  customer,
}: {
  customer: CustomerWithSubscriptions | null;
}) {
  return (
    customer?.subscriptions?.data.find((sub) => sub.status === "active") || null
  );
}
export function getCustomerTrialSubscription({
  customer,
}: {
  customer: CustomerWithSubscriptions | null;
}) {
  return (
    customer?.subscriptions?.data.find((sub) => sub.status === "trialing") ||
    null
  );
}

export async function fetchStripeSubscription(id: string) {
  try {
    return await stripe.subscriptions.retrieve(id, {
      expand: ["items.data.plan.product"],
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to fetch subscription from Stripe",
      additionalData: { id },
      label,
    });
  }
}

export async function getDataFromStripeEvent(event: Stripe.Event) {
  try {
    // Here we need to update the user's tier in the database based on the subscription they created
    const subscription = event.data.object as Stripe.Subscription;

    /** Get the product */
    const productId = subscription.items.data[0].plan.product as string;
    const product = await stripe.products.retrieve(productId);
    const customerId = subscription.customer as string;
    const tierId = product?.metadata?.shelf_tier;

    return {
      subscription,
      customerId,
      tierId,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching data from Stripe event",
      additionalData: { event },
      label,
    });
  }
}
