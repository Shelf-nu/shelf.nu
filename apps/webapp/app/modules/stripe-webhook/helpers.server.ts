import type { TierId } from "@prisma/client";
import Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { unpaidInvoiceAdminText } from "~/emails/stripe/unpaid-invoice";
import {
  ADMIN_EMAIL,
  CUSTOM_INSTALL_CUSTOMERS,
  STRIPE_WEBHOOK_ENDPOINT_SECRET,
} from "~/utils/env";
import { ShelfError } from "~/utils/error";
import {
  getCustomerSubscriptionsWithProducts,
  stripe,
  subscriptionStatusGrantsPlan,
} from "~/utils/stripe.server";
import type { UserNameFields } from "~/utils/user";

/** The user shape returned by the webhook's initial DB query */
export type WebhookUser = UserNameFields & {
  id: string;
  email: string;
  tierId: TierId;
  warnForNoPaymentMethod: boolean;
  /**
   * Support manages this user's plan by hand, so billing events never take a
   * plan away. A plan the user goes on to pay for that is higher than theirs
   * still applies.
   */
  skipSubscriptionCheck: boolean;
};

export const subscriptionTiersPriority: Record<TierId, number> = {
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
export function isAddonSubscription({
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

/** Returns true if `newTier` is strictly higher than `currentTier` */
export function isHigherTier(newTier: TierId, currentTier: TierId): boolean {
  return (
    subscriptionTiersPriority[newTier] > subscriptionTiersPriority[currentTier]
  );
}

/**
 * Whether a value is one of the app's tier ids.
 *
 * An own-key check, so a key inherited from `Object.prototype` such as
 * `"constructor"` is never taken for a tier.
 *
 * @param value - Typically a product's `shelf_tier` metadata
 * @returns `true` when the value names a tier
 */
export function isTierId(value: unknown): value is TierId {
  return (
    typeof value === "string" && Object.hasOwn(subscriptionTiersPriority, value)
  );
}

/** A line item's product: an id until expanded, or a deleted product. */
type ProductReference =
  | string
  | Stripe.Product
  | Stripe.DeletedProduct
  | null
  | undefined;

/**
 * The highest plan among some Stripe products.
 *
 * A plan product carries a `shelf_tier`. Add-on products are never plans, even
 * if one carries a `shelf_tier`, and a product that is not expanded or has been
 * deleted says nothing. Every webhook decision about which plan a subscription
 * grants reads products through this, so they all classify a product the same
 * way.
 *
 * @param products - Expanded products, for instance a subscription's line items
 * @returns The highest tier among them, or `undefined` when none is a plan
 */
export function highestPlanTier(
  products: Iterable<ProductReference>
): TierId | undefined {
  let highest: TierId | undefined;
  for (const product of products) {
    if (!product || typeof product === "string" || product.deleted) continue;
    if (product.metadata?.product_type === "addon") continue;
    const shelfTier = product.metadata?.shelf_tier;
    if (!isTierId(shelfTier)) continue;
    if (!highest || isHigherTier(shelfTier, highest)) highest = shelfTier;
  }
  return highest;
}

/**
 * The plan a customer's subscriptions grant right now.
 *
 * Only subscriptions whose status still grants a plan count
 * (`subscriptionStatusGrantsPlan`), and each one grants the highest plan among
 * its line items.
 *
 * @param subscriptions - The customer's subscriptions, products expanded
 *   (`getCustomerSubscriptionsWithProducts`)
 * @returns The highest tier any of them grants, Free when none grants one
 */
export function liveTierOf(subscriptions: Stripe.Subscription[]): TierId {
  return (
    highestPlanTier(
      subscriptions
        .filter((sub) => subscriptionStatusGrantsPlan(sub.status))
        .flatMap((sub) => sub.items.data.map((item) => item.price?.product))
    ) ?? "free"
  );
}

/** Returns true if `newTier` is higher than or equal to `currentTier` */
export function isHigherOrEqualTier(
  newTier: TierId,
  currentTier: TierId
): boolean {
  return (
    subscriptionTiersPriority[newTier] >= subscriptionTiersPriority[currentTier]
  );
}

/**
 * Sends the admin invoice notification email if ADMIN_EMAIL is configured.
 * Wraps the repeated `if (ADMIN_EMAIL) { sendEmail(...) }` pattern.
 */
export function sendAdminInvoiceEmail({
  user,
  eventType,
  invoiceId,
  subject,
}: {
  user: UserNameFields & { id: string; email: string };
  eventType: string;
  invoiceId: string;
  subject: string;
}) {
  if (ADMIN_EMAIL) {
    sendEmail({
      to: ADMIN_EMAIL,
      subject,
      text: unpaidInvoiceAdminText({ user, eventType, invoiceId }),
    });
  }
}

/** A Team workspace a plan subscription can be linked to. */
export type LinkableWorkspace = { id: string; name: string };

/**
 * The Team workspaces a user owns that no live plan subscription of their
 * customer is linked to: the workspaces a plan subscription without a
 * `metadata.organizationId` can belong to.
 *
 * A workspace counts as taken while a subscription whose status grants a plan
 * (`subscriptionStatusGrantsPlan`) and that carries a plan item names it in
 * `metadata.organizationId`. A standalone add-on subscription never takes a
 * workspace, and a paused or cancelled plan subscription releases it.
 *
 * @param args.userId - The user the customer belongs to
 * @param args.subscriptions - The customer's subscriptions, products expanded
 *   (`getCustomerSubscriptionsWithProducts`)
 * @param args.exceptSubscriptionId - A subscription to leave out, usually the
 *   one being linked, so a retried event finds the workspace it linked before
 * @returns The free workspaces, oldest first
 */
export async function findTeamWorkspacesWithoutPlan({
  userId,
  subscriptions,
  exceptSubscriptionId,
}: {
  userId: string;
  subscriptions: Stripe.Subscription[];
  exceptSubscriptionId?: string;
}): Promise<LinkableWorkspace[]> {
  const taken = new Set(
    subscriptions
      .filter(
        (sub) =>
          sub.id !== exceptSubscriptionId &&
          sub.metadata?.organizationId &&
          subscriptionStatusGrantsPlan(sub.status) &&
          highestPlanTier(sub.items.data.map((item) => item.price?.product))
      )
      .map((sub) => sub.metadata.organizationId)
  );

  const owned = await db.organization.findMany({
    where: { userId, type: "TEAM" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  return owned.filter((org) => !taken.has(org.id));
}

/** The add-ons a subscription can carry as line items. */
type BundledAddonType = "audits" | "barcodes";

/**
 * The add-ons that an active or trialing subscription carries without naming
 * a workspace, so no workspace has them switched on yet.
 *
 * @param subscriptions - The customer's subscriptions, products expanded
 * @returns The add-on types waiting for a workspace
 */
function addonsWithoutWorkspace(
  subscriptions: Stripe.Subscription[]
): Set<BundledAddonType> {
  const waiting = new Set<BundledAddonType>();
  for (const sub of subscriptions) {
    if (sub.status !== "active" && sub.status !== "trialing") continue;
    if (sub.metadata?.organizationId) continue;
    for (const item of sub.items.data) {
      const product = item.price?.product;
      if (!product || typeof product === "string" || product.deleted) continue;
      if (product.metadata?.product_type !== "addon") continue;
      const addonType = product.metadata.addon_type;
      if (addonType === "audits" || addonType === "barcodes") {
        waiting.add(addonType);
      }
    }
  }
  return waiting;
}

/**
 * Which add-ons a newly created Team workspace should be linked to, when the
 * creation link did not ask for them.
 *
 * An add-on that a live subscription of the user's customer carries without a
 * workspace goes to the new workspace when it is the only Team workspace the
 * user owns that no live plan subscription is linked to (see
 * `findTeamWorkspacesWithoutPlan`). With another such workspace around the
 * add-on could belong to either, so nothing is linked and the admin picks.
 *
 * @param args.userId - The user who created the workspace
 * @param args.organizationId - The workspace just created
 * @returns Whether to link the Audits and the Barcodes add-on
 */
export async function findAddonsAwaitingWorkspace({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<{ audits: boolean; barcodes: boolean }> {
  const none = { audits: false, barcodes: false };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { customerId: true },
  });
  if (!user?.customerId) return none;

  const subscriptions = await getCustomerSubscriptionsWithProducts(
    user.customerId
  );
  const waiting = addonsWithoutWorkspace(subscriptions);
  if (waiting.size === 0) return none;

  const free = await findTeamWorkspacesWithoutPlan({ userId, subscriptions });
  if (free.length !== 1 || free[0].id !== organizationId) return none;

  return { audits: waiting.has("audits"), barcodes: waiting.has("barcodes") };
}

/**
 * Tells the admin that a plan subscription without a workspace was linked to
 * the one Team workspace its customer owns. Sent only when `ADMIN_EMAIL` is
 * configured.
 *
 * @param args.user - The user the customer belongs to
 * @param args.subscriptionId - The subscription that was linked
 * @param args.workspace - The workspace it was linked to
 * @param args.addons - The add-ons switched on with it
 */
export function sendAdminWorkspaceLinkedEmail({
  user,
  subscriptionId,
  workspace,
  addons,
}: {
  user: { email: string };
  subscriptionId: string;
  workspace: LinkableWorkspace;
  addons: string[];
}) {
  if (!ADMIN_EMAIL) return;
  sendEmail({
    to: ADMIN_EMAIL,
    subject: `Activated: plan + add-ons linked to ${workspace.name}`,
    text: [
      "A plan subscription without a workspace was linked automatically.",
      "",
      `Customer: ${user.email}`,
      `Subscription: ${subscriptionId}`,
      `Workspace: ${workspace.name} (${workspace.id})`,
      `Add-ons switched on: ${addons.length ? addons.join(", ") : "none"}`,
      "",
      "Nothing else to do.",
    ].join("\n"),
  });
}

/**
 * Asks the admin to pick the workspace for a plan subscription whose customer
 * owns several Team workspaces it could belong to. Sent only when
 * `ADMIN_EMAIL` is configured.
 *
 * Setting `metadata.organizationId` on the subscription in Stripe raises a
 * `customer.subscription.updated` event, which switches the bundled add-ons
 * on for that workspace.
 *
 * @param args.user - The user the customer belongs to
 * @param args.subscriptionId - The subscription waiting for a workspace
 * @param args.workspaces - The workspaces it could belong to
 */
export function sendAdminPickWorkspaceEmail({
  user,
  subscriptionId,
  workspaces,
}: {
  user: { email: string };
  subscriptionId: string;
  workspaces: LinkableWorkspace[];
}) {
  if (!ADMIN_EMAIL) return;
  sendEmail({
    to: ADMIN_EMAIL,
    subject: `Needs you: customer owns ${workspaces.length} Team workspaces, pick one in Stripe metadata`,
    text: [
      "A plan subscription has no workspace, and its customer owns several",
      "Team workspaces it could belong to, so none was picked.",
      "",
      `Customer: ${user.email}`,
      `Subscription: ${subscriptionId}`,
      "",
      "Workspaces:",
      ...workspaces.map((org) => `- ${org.name}: ${org.id}`),
      "",
      "Set metadata.organizationId on the subscription in Stripe to one of",
      "these ids. The add-ons on the subscription switch on for that workspace.",
    ].join("\n"),
  });
}

/**
 * Validates the incoming webhook request and returns the verified event + user.
 *
 * Handles: signature validation, customer ID extraction (including payment_method.detached
 * edge case), early returns for payment methods without customers, user lookup,
 * and custom install customer check.
 *
 * @returns `{ event, customerId, user }` where `user` is null for custom install customers
 * @throws ShelfError on validation failure
 */
export async function constructVerifiedWebhookEvent(request: Request): Promise<{
  event: Stripe.Event;
  customerId: string;
  user: WebhookUser | null;
}> {
  const payload = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    throw new ShelfError({
      cause: null,
      message: "Missing stripe-signature header",
      label: "Stripe webhook",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  if (!STRIPE_WEBHOOK_ENDPOINT_SECRET) {
    throw new ShelfError({
      cause: null,
      message: "STRIPE_WEBHOOK_ENDPOINT_SECRET is not configured",
      label: "Stripe webhook",
      status: 500,
      shouldBeCaptured: true,
    });
  }

  if (!stripe) {
    throw new ShelfError({
      cause: null,
      message:
        "Stripe client is not initialized. Check that STRIPE_SECRET_KEY is configured and premium features are enabled.",
      label: "Stripe webhook",
      status: 500,
      shouldBeCaptured: true,
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      sig,
      STRIPE_WEBHOOK_ENDPOINT_SECRET
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        cause instanceof Stripe.errors.StripeSignatureVerificationError
          ? "Stripe webhook signature verification failed"
          : "Failed to construct Stripe webhook event",
      label: "Stripe webhook",
      status:
        cause instanceof Stripe.errors.StripeSignatureVerificationError
          ? 400
          : 500,
      shouldBeCaptured: true,
      additionalData: {
        errorType:
          cause instanceof Error ? cause.constructor.name : typeof cause,
      },
    });
  }

  const eventData = event.data.object as { customer: string | null };

  // For payment_method.detached, customer is null on the object but available in previous_attributes
  let customerId = eventData.customer;
  if (!customerId && event.type === "payment_method.detached") {
    const previousAttributes = event.data.previous_attributes as
      | { customer?: string }
      | undefined;
    customerId = previousAttributes?.customer ?? null;
  }

  // If we still don't have a customerId, return early for payment method events
  // (this can happen if the payment method was never attached to a customer)
  if (!customerId) {
    if (
      event.type === "payment_method.attached" ||
      event.type === "payment_method.detached"
    ) {
      // Caller should return 200 — we signal this by throwing a special non-error response.
      // Instead, we use a sentinel: returning a response directly isn't possible here,
      // so we throw a tagged error the caller can catch.
      throw new PaymentMethodWithoutCustomerResponse();
    }
    // For other events, customerId is required
    throw new ShelfError({
      cause: null,
      message: "No customer ID found in event",
      additionalData: { event: event.type },
      label: "Stripe webhook",
      status: 400,
    });
  }

  const user = await db.user
    .findFirstOrThrow({
      where: { customerId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        tierId: true,
        warnForNoPaymentMethod: true,
        skipSubscriptionCheck: true,
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

  // Custom install users — no processing needed
  if (
    parseCustomInstallCustomers(CUSTOM_INSTALL_CUSTOMERS).includes(customerId)
  ) {
    return { event, customerId, user: null };
  }

  return { event, customerId, user };
}

/**
 * Parses the comma-separated `CUSTOM_INSTALL_CUSTOMERS` env var into customer
 * ids.
 *
 * Entries are trimmed: a list written the way a human writes one,
 * `cus_A, cus_B`, otherwise yields `" cus_B"`, which matches no customer. The
 * consequence is not a missed match but an inverted one — a self-hosted
 * customer stops being excluded from webhook processing and gets downgraded to
 * free and their subscription paused.
 *
 * Casing is preserved: Stripe customer ids are case-sensitive, so normalising
 * them the way domain lists are normalised would break every match.
 *
 * @param raw - The raw env var value, possibly undefined
 * @returns Customer ids, empty entries dropped
 */
export function parseCustomInstallCustomers(
  raw: string | undefined | null
): string[] {
  return (raw ?? "")
    .split(",")
    .map((customerId) => customerId.trim())
    .filter(Boolean);
}

/**
 * Sentinel class used when a payment method event has no customer.
 * The route catches this and returns 200.
 */
export class PaymentMethodWithoutCustomerResponse {
  readonly _tag = "PaymentMethodWithoutCustomerResponse" as const;
}
