import type { User } from "@prisma/client";
import type Stripe from "stripe";
import type { PriceWithProduct } from "~/components/subscription/prices";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { premiumIsEnabled, stripe } from "~/utils/stripe.server";

const label: ErrorLabel = "Stripe";

/** Creates a Stripe checkout session for the audit add-on */
export async function createAuditAddonCheckoutSession({
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

    const { url } = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${domainUrl}/audits?success=true`,
      cancel_url: `${domainUrl}/audits?canceled=true`,
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
        "Something went wrong while creating audit add-on checkout session. Please try again later or contact support.",
      additionalData: { priceId, userId, domainUrl, customerId },
      label,
    });
  }
}

/** Creates a trial subscription for the audit add-on directly via Stripe API */
export async function createAuditAddonTrialSubscription({
  customerId,
  priceId,
  userId,
}: {
  customerId: string;
  priceId: Stripe.Price["id"];
  userId: User["id"];
}) {
  try {
    if (!stripe) {
      throw new ShelfError({
        cause: null,
        message: "Stripe not initialized",
        additionalData: { customerId, priceId, userId },
        label,
      });
    }

    // If the customer has a payment method, set it as default so Stripe
    // can auto-charge when the trial ends (avoids past_due after trial).
    // If no payment method exists (e.g. team trial user), Stripe will
    // handle payment collection via invoice when the trial ends.
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      limit: 1,
    });

    const defaultPaymentMethod = paymentMethods.data[0]?.id;

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: 7,
      ...(defaultPaymentMethod && {
        default_payment_method: defaultPaymentMethod,
      }),
      metadata: { userId },
    });

    return { subscription, hasPaymentMethod: !!defaultPaymentMethod };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating audit add-on trial. Please try again later or contact support.",
      additionalData: { customerId, priceId, userId },
      label,
    });
  }
}

/** Fetches audit add-on prices from Stripe */
export async function getAuditAddonPrices() {
  try {
    if (!premiumIsEnabled || !stripe) {
      return { month: null, year: null };
    }

    const pricesResponse = await stripe.prices.list({
      active: true,
      type: "recurring",
      expand: ["data.product"],
      limit: 100,
    });

    const auditPrices = pricesResponse.data.filter((p) => {
      const product = p.product as Stripe.Product;
      return (
        product?.metadata?.product_type === "addon" &&
        product?.metadata?.addon_type === "audits"
      );
    }) as PriceWithProduct[];

    const monthlyPrice =
      auditPrices.find((p) => p.recurring?.interval === "month") || null;
    const yearlyPrice =
      auditPrices.find((p) => p.recurring?.interval === "year") || null;

    return { month: monthlyPrice, year: yearlyPrice };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching audit add-on prices.",
      label,
    });
  }
}

/**
 * Handles audit add-on subscription webhook events.
 * Sets hasAuditAddon and usedAuditTrial flags based on subscription state.
 */
export async function handleAuditAddonWebhook({
  eventType,
  subscription,
  customerId,
}: {
  eventType: string;
  subscription?: Stripe.Subscription;
  customerId: string;
}) {
  switch (eventType) {
    case "checkout.session.completed":
    case "customer.subscription.created": {
      const isTrialSubscription =
        subscription && !!subscription.trial_end && !!subscription.trial_start;

      await db.user.update({
        where: { customerId },
        data: {
          hasAuditAddon: true,
          ...(isTrialSubscription && { usedAuditTrial: true }),
        },
        select: { id: true },
      });
      break;
    }
    case "customer.subscription.updated": {
      const isActive =
        subscription?.status === "active" ||
        subscription?.status === "trialing";
      await db.user.update({
        where: { customerId },
        data: { hasAuditAddon: isActive },
        select: { id: true },
      });
      break;
    }
    case "customer.subscription.paused":
    case "customer.subscription.deleted": {
      await db.user.update({
        where: { customerId },
        data: { hasAuditAddon: false },
        select: { id: true },
      });
      break;
    }
    // trial_will_end: no action needed, user still has access
    default:
      break;
  }
}
