import type { User } from "@prisma/client";
import Stripe from "stripe";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { db } from "~/database";
import { ENABLE_PREMIUM_FEATURES, STRIPE_SECRET_KEY } from "./env";

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
    ENABLE_PREMIUM_FEATURES &&
    STRIPE_SECRET_KEY !== "" &&
    typeof STRIPE_SECRET_KEY === "string"
  ) {
    // Reference : https://github.com/stripe/stripe-node#usage-with-typescript
    _stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2022-11-15",
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
    throw new Error("Could not determine domain URL.");
  }
  const protocol = host.includes("localhost") ? "http" : "https";
  return `${protocol}://${host}`;
}

/** Needed when user has no subscription and wants to buy their first one */
export const createStripeCheckoutSession = async ({
  priceId,
  userId,
  domainUrl,
  customerId,
}: {
  priceId: Stripe.Price["id"];
  userId: User["id"];
  domainUrl: string;
  customerId: string;
}): Promise<string> => {
  if (!stripe) return Promise.reject("Stripe not initialized");
  const SECRET_KEY = STRIPE_SECRET_KEY;

  if (!SECRET_KEY) return Promise.reject("Stripe secret key not found");

  const lineItems = [
    {
      price: priceId,
      quantity: 1,
    },
  ];
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: lineItems,
    success_url: `${domainUrl}/settings/subscription?success=true`,
    cancel_url: `${domainUrl}/settings/subscription?canceled=true`,
    client_reference_id: userId,
    customer: customerId,
  });

  // @ts-ignore
  return session.url;
};

/** Fetches prices and products from stripe */
export const getStripePricesAndProducts = async () => {
  const pricesResponse = await stripe.prices.list({
    active: true,
    expand: ["data.product"],
  });
  const prices = groupPricesByInterval(
    pricesResponse.data as PriceWithProduct[]
  );
  return prices;
};

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
};

/** Fetches customer based on ID */
export const getStripeCustomer = async (customerId: string) => {
  const customer = await stripe.customers.retrieve(customerId, {
    expand: ["subscriptions"],
  });
  return customer;
};

export async function createBillingPortalSession({
  customerId,
}: {
  customerId: string;
}) {
  const { url } = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.SERVER_URL}/settings/subscription`,
  });

  return { url };
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

export async function fetchStripeSubscription(id: string) {
  return await stripe.subscriptions.retrieve(id, {
    expand: ["items.data.plan.product"],
  });
}
