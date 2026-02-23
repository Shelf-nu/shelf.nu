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
  organizationId,
}: {
  priceId: Stripe.Price["id"];
  userId: User["id"];
  domainUrl: string;
  customerId: string;
  organizationId: string;
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
      subscription_data: {
        metadata: { organizationId },
      },
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
  organizationId,
}: {
  customerId: string;
  priceId: Stripe.Price["id"];
  userId: User["id"];
  organizationId: string;
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
      trial_settings: {
        end_behavior: {
          missing_payment_method: "pause",
        },
      },
      ...(defaultPaymentMethod && {
        default_payment_method: defaultPaymentMethod,
      }),
      metadata: { userId, organizationId },
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
 * Links an existing audit add-on subscription item to a newly created organization.
 * Used during workspace creation when the team checkout included audits.
 *
 * Finds the customer's active/trialing subscription that contains an audit addon item,
 * updates the subscription metadata with the organizationId, and enables audits on the org.
 */
export async function linkAuditAddonToOrganization({
  customerId,
  organizationId,
}: {
  customerId: string;
  organizationId: string;
}) {
  try {
    if (!stripe) {
      throw new ShelfError({
        cause: null,
        message: "Stripe not initialized",
        additionalData: { customerId, organizationId },
        label,
      });
    }

    // Find subscriptions for this customer (no deep expansion —
    // Stripe list API only allows 4 levels, and
    // data.items.data.price.product would be 5)
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
    });

    // Check each active/trialing subscription's items by retrieving products
    let auditSubscription: Stripe.Subscription | undefined;
    for (const sub of subscriptions.data) {
      if (sub.status !== "active" && sub.status !== "trialing") continue;

      for (const item of sub.items.data) {
        const productId =
          typeof item.price.product === "string"
            ? item.price.product
            : item.price.product?.id;
        if (!productId) continue;

        const product = await stripe.products.retrieve(productId);
        if (
          product.metadata?.product_type === "addon" &&
          product.metadata?.addon_type === "audits"
        ) {
          auditSubscription = sub;
          break;
        }
      }
      if (auditSubscription) break;
    }

    if (!auditSubscription) {
      throw new ShelfError({
        cause: null,
        message:
          "No active subscription with audit addon found for this customer",
        additionalData: { customerId, organizationId },
        label,
      });
    }

    const isTrialing = auditSubscription.status === "trialing";

    // Update subscription metadata with the organizationId
    await stripe.subscriptions.update(auditSubscription.id, {
      metadata: {
        ...auditSubscription.metadata,
        organizationId,
      },
    });

    // Enable audits on the organization
    await db.organization.update({
      where: { id: organizationId },
      data: {
        auditsEnabled: true,
        auditsEnabledAt: new Date(),
        ...(isTrialing && { usedAuditTrial: true }),
      },
      select: { id: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while linking audit add-on to organization.",
      additionalData: { customerId, organizationId },
      label,
    });
  }
}

/**
 * Fetches the current audit add-on subscription info for a customer.
 * Returns the billing interval and price, or null if no subscription found.
 */
export async function getAuditSubscriptionInfo({
  customerId,
}: {
  customerId: string;
}): Promise<{
  interval: "month" | "year";
  amount: number;
  currency: string;
  status: string;
} | null> {
  try {
    if (!stripe) return null;

    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
    });

    // Check each subscription's items by retrieving the product separately
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        const productId =
          typeof item.price.product === "string"
            ? item.price.product
            : item.price.product?.id;
        if (!productId) continue;

        const product = await stripe.products.retrieve(productId);
        if (
          product.metadata?.product_type === "addon" &&
          product.metadata?.addon_type === "audits"
        ) {
          return {
            interval:
              (item.price.recurring?.interval as "month" | "year") || "year",
            amount: item.price.unit_amount || 0,
            currency: item.price.currency,
            status: sub.status,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Handles audit add-on subscription webhook events.
 * Sets auditsEnabled and usedAuditTrial flags on the Organization.
 */
export async function handleAuditAddonWebhook({
  eventType,
  subscription,
  organizationId,
}: {
  eventType: string;
  subscription?: Stripe.Subscription;
  organizationId: string;
}) {
  switch (eventType) {
    case "checkout.session.completed":
    case "customer.subscription.created": {
      const isTrialSubscription =
        subscription && !!subscription.trial_end && !!subscription.trial_start;

      await db.organization.update({
        where: { id: organizationId },
        data: {
          auditsEnabled: true,
          auditsEnabledAt: new Date(),
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
      await db.organization.update({
        where: { id: organizationId },
        data: { auditsEnabled: isActive },
        select: { id: true },
      });
      break;
    }
    case "customer.subscription.paused":
    case "customer.subscription.deleted": {
      await db.organization.update({
        where: { id: organizationId },
        data: { auditsEnabled: false },
        select: { id: true },
      });
      break;
    }
    // trial_will_end: no action needed, user still has access
    default:
      break;
  }
}
