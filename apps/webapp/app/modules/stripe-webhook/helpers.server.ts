import { TierId } from "@prisma/client";
import Stripe from "stripe";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { unpaidInvoiceAdminText } from "~/emails/stripe/unpaid-invoice";
import { handleAuditAddonWebhook } from "~/modules/audit/addon.server";
import { handleBarcodeAddonWebhook } from "~/modules/barcode/addon.server";
import type { AddonType } from "~/modules/billing/price-validation.server";
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
 * Subscription metadata key set when the admin has been asked to pick the
 * subscription's workspace, so a retried or later event does not ask again.
 */
export const WORKSPACE_PICK_REQUESTED_KEY = "workspacePickRequestedAt";

/**
 * The Team workspaces a user owns, oldest first.
 *
 * @param userId - The owner
 * @returns The workspaces' ids and names
 */
export function findOwnedTeamWorkspaces(
  userId: string
): Promise<LinkableWorkspace[]> {
  return db.organization.findMany({
    where: { userId, type: "TEAM" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Whether a subscription carries a Team (or higher) plan item. Plus plans
 * have no Team workspace, so they never take or wait for one.
 */
function carriesTeamPlan(subscription: Stripe.Subscription): boolean {
  const tier = highestPlanTier(
    subscription.items.data.map((item) => item.price?.product)
  );
  return !!tier && isHigherOrEqualTier(tier, TierId.tier_2);
}

/**
 * Works out which Team workspace a plan subscription without a
 * `metadata.organizationId` belongs to, from the customer's subscriptions
 * and the Team workspaces the user owns.
 *
 * A workspace is taken while a live Team plan subscription (status grants a
 * plan, per `subscriptionStatusGrantsPlan`, and it carries a Team or higher
 * plan item, `carriesTeamPlan`) names it in
 * `metadata.organizationId`. A standalone add-on subscription never takes a
 * workspace, and a paused or cancelled plan subscription releases it. The
 * rest are the candidates.
 *
 * The answer is a single workspace only when there is exactly one candidate
 * and at most one live plan subscription names no workspace. A second
 * unlinked plan subscription may be paying for that candidate already (a
 * Team plan bought through Checkout names no workspace), so then the
 * candidates are returned for someone to pick from instead.
 *
 * @param args.owned - The Team workspaces the user owns
 *   (`findOwnedTeamWorkspaces`)
 * @param args.subscriptions - The customer's subscriptions, products expanded
 *   (`getCustomerSubscriptionsWithProducts`)
 * @returns `candidates`: the untaken workspaces; `unlinkedPlans`: the live
 *   plan subscriptions that name no workspace; `workspace`: the one to link,
 *   or `null` when there is none or the choice is not certain
 */
export function resolveTeamWorkspaceForPlan({
  owned,
  subscriptions,
}: {
  owned: LinkableWorkspace[];
  subscriptions: Stripe.Subscription[];
}): {
  candidates: LinkableWorkspace[];
  unlinkedPlans: Stripe.Subscription[];
  workspace: LinkableWorkspace | null;
} {
  const livePlans = subscriptions.filter(
    (sub) => subscriptionStatusGrantsPlan(sub.status) && carriesTeamPlan(sub)
  );
  const taken = new Set(
    livePlans
      .map((sub) => sub.metadata?.organizationId)
      .filter((organizationId): organizationId is string => !!organizationId)
  );
  const unlinkedPlans = livePlans.filter(
    (sub) => !sub.metadata?.organizationId
  );
  const candidates = owned.filter((org) => !taken.has(org.id));

  return {
    candidates,
    unlinkedPlans,
    workspace:
      candidates.length === 1 && unlinkedPlans.length <= 1
        ? candidates[0]
        : null,
  };
}

/** The add-on types among a subscription's line items, products expanded. */
export function addonTypesOf(subscription: Stripe.Subscription): AddonType[] {
  const types: AddonType[] = [];
  for (const item of subscription.items.data) {
    const product = item.price?.product;
    if (!product || typeof product === "string" || product.deleted) continue;
    if (product.metadata?.product_type !== "addon") continue;
    const addonType = product.metadata.addon_type;
    if (addonType === "audits" || addonType === "barcodes") {
      types.push(addonType);
    }
  }
  return types;
}

/**
 * Whether a subscription is billed by invoice (`collection_method:
 * "send_invoice"`), which is how subscriptions created by hand in the Stripe
 * dashboard for invoice-billed customers are set up. Checkout subscriptions
 * charge a card and reach their workspace through the creation link instead.
 */
export function isInvoiceBilled(subscription: Stripe.Subscription): boolean {
  return subscription.collection_method === "send_invoice";
}

/**
 * The metadata that links a subscription to a workspace: its current
 * metadata plus `organizationId`, with the "admin was asked" mark removed
 * (an empty value removes a key in Stripe).
 *
 * @param metadata - The subscription's metadata as Stripe holds it now
 * @param organizationId - The workspace it belongs to
 */
export function linkedMetadata(
  metadata: Stripe.Metadata | undefined,
  organizationId: string
): Stripe.MetadataParam {
  return {
    ...metadata,
    organizationId,
    ...(metadata?.[WORKSPACE_PICK_REQUESTED_KEY] && {
      [WORKSPACE_PICK_REQUESTED_KEY]: "",
    }),
  };
}

/**
 * Asks the admin to pick a workspace for these subscriptions, once: the
 * subscriptions already asked about (`WORKSPACE_PICK_REQUESTED_KEY`) are
 * left out, and the rest are marked before the email goes out, so a retried
 * event that fails after the email does not send it again. Does nothing
 * when `ADMIN_EMAIL` is not configured.
 *
 * @param args.user - The user the customer belongs to
 * @param args.subscriptions - The subscriptions waiting for a workspace
 * @param args.related - Other subscriptions the admin needs to see to
 *   decide (another unlinked plan), listed but not marked
 * @param args.ownedCount - How many Team workspaces the customer owns
 * @param args.candidates - The workspaces no live plan is linked to
 */
export async function askAdminToPickWorkspaceOnce({
  user,
  subscriptions,
  related = [],
  ownedCount,
  candidates,
}: {
  user: { email: string };
  subscriptions: Stripe.Subscription[];
  related?: Stripe.Subscription[];
  ownedCount: number;
  candidates: LinkableWorkspace[];
}) {
  // The mark means "the admin was told": without a recipient, leave it off
  // so a later event can still ask once one is configured.
  if (!ADMIN_EMAIL) return;
  const unasked = subscriptions.filter(
    (sub) => !sub.metadata?.[WORKSPACE_PICK_REQUESTED_KEY]
  );
  if (unasked.length === 0) return;

  const askedAt = new Date().toISOString();
  for (const sub of unasked) {
    await stripe.subscriptions.update(sub.id, {
      metadata: { ...sub.metadata, [WORKSPACE_PICK_REQUESTED_KEY]: askedAt },
    });
  }

  const ids = new Set([...subscriptions, ...related].map((sub) => sub.id));
  sendAdminPickWorkspaceEmail({
    user,
    subscriptionIds: [...ids],
    ownedCount,
    candidates,
  });
}

/**
 * Gives a newly created Team workspace the invoice-billed subscriptions the
 * user holds without a workspace, and switches their add-ons on there.
 *
 * The waiting subscriptions are the live, invoice-billed ones
 * (`isInvoiceBilled`) that name no workspace and carry a Team plan or an
 * add-on. When `resolveTeamWorkspaceForPlan` answers with the new workspace
 * and at most one waiting subscription carries add-ons, each waiting
 * subscription gets `metadata.organizationId` (`linkedMetadata`) and its
 * add-ons are switched on through the add-on handlers, for that exact
 * subscription. A `past_due` one keeps its add-ons, as its plan does. In
 * every other case where add-ons are waiting, the admin is asked to pick,
 * once per subscription: nothing else would ever place them.
 *
 * Checkout subscriptions are left to the creation link's `includesAudits` /
 * `includesBarcodes` params.
 *
 * Stripe's plain subscription list is read first, and the products are only
 * looked up when a live invoice-billed subscription names no workspace, so a
 * workspace created by any other customer costs one Stripe call.
 *
 * @param args.userId - The user who created the workspace
 * @param args.organizationId - The workspace just created
 */
export async function linkWaitingSubscriptionsToWorkspace({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { customerId: true, email: true },
  });
  if (!user?.customerId || !stripe) return;

  const isWaiting = (sub: Stripe.Subscription) =>
    subscriptionStatusGrantsPlan(sub.status) &&
    !sub.metadata?.organizationId &&
    isInvoiceBilled(sub);

  const listed = await stripe.subscriptions.list({
    customer: user.customerId,
    limit: 100,
  });
  if (!listed.has_more && !listed.data.some(isWaiting)) return;

  const subscriptions = await getCustomerSubscriptionsWithProducts(
    user.customerId
  );
  const waiting = subscriptions.filter(
    (sub) =>
      isWaiting(sub) && (carriesTeamPlan(sub) || addonTypesOf(sub).length)
  );
  if (waiting.length === 0) return;

  const owned = await findOwnedTeamWorkspaces(userId);
  const { candidates, unlinkedPlans, workspace } = resolveTeamWorkspaceForPlan({
    owned,
    subscriptions,
  });
  const withAddons = waiting.filter((sub) => addonTypesOf(sub).length > 0);

  // Two subscriptions carrying add-ons may be meant for two workspaces.
  if (workspace?.id !== organizationId || withAddons.length > 1) {
    if (withAddons.length > 0) {
      await askAdminToPickWorkspaceOnce({
        user,
        subscriptions: withAddons,
        related: unlinkedPlans,
        ownedCount: owned.length,
        candidates,
      });
    }
    return;
  }

  // Add-ons first, then the metadata, as in `linkSubscriptionToTeamWorkspace`:
  // if switching an add-on on fails, the subscription is still unlinked, so
  // the admin's "set metadata.organizationId" fix (or the next workspace
  // creation) still applies.
  for (const sub of waiting) {
    // The handlers' creation branch switches the add-on on for the workspace
    // (and records a used trial), whatever the subscription's live status.
    const linked = {
      ...sub,
      metadata: { ...sub.metadata, organizationId },
    } as Stripe.Subscription;
    const addonTypes = addonTypesOf(sub);
    if (addonTypes.includes("audits")) {
      await handleAuditAddonWebhook({
        eventType: "customer.subscription.created",
        subscription: linked,
        organizationId,
      });
    }
    if (addonTypes.includes("barcodes")) {
      await handleBarcodeAddonWebhook({
        eventType: "customer.subscription.created",
        subscription: linked,
        organizationId,
      });
    }

    await stripe.subscriptions.update(sub.id, {
      metadata: linkedMetadata(sub.metadata, organizationId),
    });
  }
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
 * Asks the admin to pick the workspace for subscriptions that
 * `resolveTeamWorkspaceForPlan` could not place with certainty. Sent only
 * when `ADMIN_EMAIL` is configured.
 *
 * The subject names the reason: several Team workspaces could be meant, or
 * one workspace but more than one subscription (plans or add-ons) without a
 * workspace. Setting `metadata.organizationId` on a subscription in Stripe
 * raises a `customer.subscription.updated` event, which switches its bundled
 * add-ons on for that workspace.
 *
 * @param args.user - The user the customer belongs to
 * @param args.subscriptionIds - The subscriptions waiting for a workspace
 * @param args.ownedCount - How many Team workspaces the customer owns
 * @param args.candidates - The workspaces no live plan is linked to
 */
export function sendAdminPickWorkspaceEmail({
  user,
  subscriptionIds,
  ownedCount,
  candidates,
}: {
  user: { email: string };
  subscriptionIds: string[];
  ownedCount: number;
  candidates: LinkableWorkspace[];
}) {
  if (!ADMIN_EMAIL) return;
  const subject =
    candidates.length > 1
      ? `Needs you: customer owns ${ownedCount} Team workspaces, pick one in Stripe metadata`
      : "Needs you: more than one subscription has no workspace, pick in Stripe metadata";
  sendEmail({
    to: ADMIN_EMAIL,
    subject,
    text: [
      "A subscription has no workspace and Shelf could not tell which Team",
      "workspace it belongs to, so none was picked. Either several workspaces",
      "could be meant, or more than one subscription of the customer (plans",
      "or add-ons) names no workspace.",
      "",
      `Customer: ${user.email}`,
      `Team workspaces owned: ${ownedCount}`,
      "",
      "Subscriptions without a workspace:",
      ...subscriptionIds.map((id) => `- ${id}`),
      "",
      "Workspaces no live plan subscription is linked to:",
      ...(candidates.length
        ? candidates.map((org) => `- ${org.name}: ${org.id}`)
        : ["- none"]),
      "",
      "Set metadata.organizationId on each subscription in Stripe to the",
      "workspace id it pays for. Its add-ons switch on for that workspace.",
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
