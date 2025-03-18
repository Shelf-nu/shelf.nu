import type { Organization, User } from "@prisma/client";
import Stripe from "stripe";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { getOrganizationByUserId } from "~/modules/organization/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { STRIPE_SECRET_KEY } from "./env";
import type { ErrorLabel } from "./error";
import { ShelfError } from "./error";

const label: ErrorLabel = "Stripe";
export const premiumIsEnabled = config.enablePremiumFeatures;

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
    premiumIsEnabled &&
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
  intent,
  shelfTier,
}: {
  priceId: Stripe.Price["id"];
  userId: User["id"];
  domainUrl: string;
  customerId: string;
  intent: "trial" | "subscribe";
  shelfTier: "tier_1" | "tier_2";
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

    const successUrl = await generateReturnUrl({
      userId,
      shelfTier,
      intent,
      domainUrl,
    });

    const { url } = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: `${domainUrl}/account-details/subscription?canceled=true`,
      client_reference_id: userId,
      customer: customerId,
      ...(intent === "trial" && {
        subscription_data: {
          trial_settings: {
            end_behavior: {
              missing_payment_method: "pause",
            },
          },
          trial_period_days: config.freeTrialDays,
        },
        payment_method_collection: "if_required",
      }),
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
      type: "recurring",
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

/** Fetches prices and products from stripe */
export async function getStripePricesForTrialPlanSelection() {
  try {
    const pricesResponse = await stripe.prices.list({
      active: true,
      type: "recurring",
      expand: ["data.product"],
    });
    const groupedPrices = groupPricesByInterval(
      pricesResponse.data as PriceWithProduct[]
    );
    return [
      ...groupedPrices.month.filter(
        (price) =>
          price.product.metadata.shelf_tier === "tier_2" &&
          price.metadata.show_on_table === "true" &&
          price.metadata.legacy !== "true"
      ),
      ...groupedPrices.year.filter(
        (price) =>
          price.product.metadata.shelf_tier === "tier_2" &&
          price.metadata.show_on_table === "true" &&
          price.metadata.legacy !== "true"
      ),
    ];
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
    if (premiumIsEnabled && stripe) {
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
      return_url: `${process.env.SERVER_URL}/account-details/subscription`,
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

/** Gets the customer's paid subscription */
export function getCustomerPaidSubscription({
  customer,
}: {
  customer: CustomerWithSubscriptions | null;
}) {
  return (
    customer?.subscriptions?.data.find((sub) => sub.status === "active") || null
  );
}

/** Gets the trial subscription from customers subscription */
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

export function getCustomerActiveSubscription({
  customer,
}: {
  customer: CustomerWithSubscriptions | null;
}) {
  /** Get the trial subscription */
  const trialSubscription = getCustomerTrialSubscription({ customer });

  /** Get a normal subscription */
  const paidSubscription = getCustomerPaidSubscription({ customer });

  /** WE prioritize active subscrption over trial */
  return paidSubscription || trialSubscription;
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
      status: 500,
    });
  }
}

export const disabledTeamOrg = async ({
  currentOrganization,
  organizations,
  url,
}: {
  organizations: Pick<
    Organization,
    "id" | "type" | "name" | "imageId" | "userId"
  >[];
  currentOrganization: Pick<Organization, "id" | "type">;
  url: string;
}) => {
  if (!premiumIsEnabled) return false;
  /**
   * We need to check a few things before disabling team orgs
   *
   * 1. The current organization is a team
   * 2. The current tier has to be tier_2. Anything else is not allowed
   * 3. We need to check the url as the user should be allowed to access certain urls, even if the current org is a team org and they are Self service
   */

  /** All account details routes should be accessible always */
  if (url.includes("account-details")) return false;
  const tierLimit = await getOrganizationTierLimit({
    organizationId: currentOrganization.id,
    organizations,
  });

  return (
    currentOrganization.type === "TEAM" &&
    ["free", "tier_1"].includes(tierLimit?.id)
  );
};

/** Generates the redirect URL based on relevant data */
async function generateReturnUrl({
  userId,
  shelfTier,
  intent,
  domainUrl,
}: {
  userId: User["id"];
  shelfTier: "tier_1" | "tier_2" | "free" | "custom";
  intent: "trial" | "subscribe";
  domainUrl: string;
}) {
  /**
   * Here we have a few cases:
   * 1. If its trial and tier_2, and they dont own team workspaces we redirect them to create a team workspace - we can safely assume that is their first entrance
   * 3. If its any other tier, we redirect them to /account-details/subscription
   */

  /** We do a small try/catch to prevent throwing as we just need to continue */
  let userTeamOrg;
  try {
    userTeamOrg = await getOrganizationByUserId({
      userId,
      orgType: "TEAM",
    });
  } catch (cause) {
    userTeamOrg = null;
  }

  const urlSearchParams = new URLSearchParams({
    success: "true",
    team: shelfTier === "tier_2" ? "true" : "",
    ...(intent === "trial" && { trial: "true" }),
    ...(userTeamOrg && { hasExistingWorkspace: "true" }),
  });

  return shelfTier === "tier_2" && !userTeamOrg // If the user is on tier_2, and they dont already OWN a team org we redirect them to create a team workspace
    ? `${domainUrl}/account-details/workspace/new?${urlSearchParams.toString()}`
    : `${domainUrl}/account-details/subscription?${urlSearchParams.toString()}`;
}
