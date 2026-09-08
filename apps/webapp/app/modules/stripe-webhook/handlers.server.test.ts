/**
 * Stripe webhook handlers — add-ons bundled on a tier subscription.
 *
 * A Team trial or checkout can carry the Audits and Barcodes add-ons as extra
 * line items on the tier subscription. Once workspace creation has linked that
 * subscription to an organization, the organization's add-on flags follow the
 * subscription's lifecycle exactly as they do for a standalone add-on
 * subscription: paused or cancelled means off, an item dropped from the
 * subscription means off, and the add-on handlers see every status change.
 */
import { TierId } from "@prisma/client";
import type Stripe from "stripe";
import { describe, it, expect, vi, beforeEach } from "vitest";

// why: env module reads process.env at import time; the webhook helpers need
// the admin/webhook values to exist
vi.mock(import("~/utils/env"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    STRIPE_WEBHOOK_ENDPOINT_SECRET: "whsec_test",
    ADMIN_EMAIL: undefined,
    CUSTOM_INSTALL_CUSTOMERS: "",
    SERVER_URL: "https://app.shelf.nu",
  };
});

// why: Database module connects to Prisma during import
const { mockUserUpdate, mockOrgUpdate } = vi.hoisted(() => ({
  mockUserUpdate: vi.fn(),
  mockOrgUpdate: vi.fn(),
}));
vi.mock("~/database/db.server", () => ({
  db: {
    user: { update: mockUserUpdate },
    organization: { update: mockOrgUpdate },
  },
}));

// why: Stripe SDK makes external API calls. The event parser is where line
// items are resolved to tier/add-on products, so each test states its result.
const { mockGetDataFromStripeEvent, mockProductsRetrieve } = vi.hoisted(() => ({
  mockGetDataFromStripeEvent: vi.fn(),
  mockProductsRetrieve: vi.fn(),
}));
vi.mock("~/utils/stripe.server", () => ({
  stripe: {
    products: { retrieve: mockProductsRetrieve },
    subscriptions: { update: vi.fn() },
  },
  getDataFromStripeEvent: mockGetDataFromStripeEvent,
  customerHasPaymentMethod: vi.fn(),
  fetchStripeSubscription: vi.fn(),
  getCustomerActiveSubscription: vi.fn(),
  getCustomerNotificationData: vi.fn(),
  getInvoiceNotificationData: vi.fn(),
  getStripeCustomer: vi.fn(),
}));

// why: the add-on handlers are the collaborators under test — what matters is
// that the tier branch reaches them with the event, not what they write
const { mockAuditAddonWebhook, mockBarcodeAddonWebhook } = vi.hoisted(() => ({
  mockAuditAddonWebhook: vi.fn(),
  mockBarcodeAddonWebhook: vi.fn(),
}));
vi.mock("~/modules/audit/addon.server", () => ({
  handleAuditAddonWebhook: mockAuditAddonWebhook,
}));
vi.mock("~/modules/barcode/addon.server", () => ({
  handleBarcodeAddonWebhook: mockBarcodeAddonWebhook,
}));

// why: email, analytics, scheduler, branding and date-pref modules reach
// external services or the database
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));
vi.mock("~/emails/stripe/audit-trial-ends-soon", () => ({
  sendAuditTrialEndsSoonEmail: vi.fn(),
}));
vi.mock("~/emails/stripe/barcode-trial-ends-soon", () => ({
  sendBarcodeTrialEndsSoonEmail: vi.fn(),
}));
vi.mock("~/emails/stripe/subscription-granted", () => ({
  subscriptionGrantedText: vi.fn(),
}));
vi.mock("~/emails/stripe/trial-ends-soon", () => ({
  sendTrialEndsSoonEmail: vi.fn(),
}));
vi.mock("~/emails/stripe/unpaid-invoice", () => ({
  unpaidInvoiceUserText: vi.fn(),
  unpaidInvoiceAdminText: vi.fn(),
}));
vi.mock("~/emails/stripe/welcome-to-trial", () => ({
  sendTeamTrialWelcomeEmail: vi.fn(),
}));
vi.mock("~/integrations/posthog/client.server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("~/modules/addon-trial/scheduler.server", () => ({
  scheduleTrialEndsTomorrowEmail: vi.fn(),
}));
vi.mock("~/modules/organization/service.server", () => ({
  resetPersonalWorkspaceBranding: vi.fn(),
}));
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn(),
}));
// why: Logger makes external calls
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import {
  handleSubscriptionDeleted,
  handleSubscriptionPaused,
  handleSubscriptionUpdated,
} from "./handlers.server";
import type { WebhookUser } from "./helpers.server";

const TEAM_PRODUCT = "prod_team";
const BARCODES_PRODUCT = "prod_barcodes";
const AUDITS_PRODUCT = "prod_audits";

const user = {
  id: "user-1",
  email: "owner@example.com",
  tierId: TierId.tier_2,
  warnForNoPaymentMethod: false,
  firstName: "Alice",
  lastName: "Owner",
} as WebhookUser;

/** A subscription carrying one line item per product id. */
function buildSubscription({
  productIds = [TEAM_PRODUCT],
  status = "active",
  metadata = { organizationId: "org-1" },
}: {
  productIds?: string[];
  status?: Stripe.Subscription.Status;
  metadata?: Record<string, string>;
} = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status,
    metadata,
    trial_end: null,
    items: {
      data: productIds.map((product, index) => ({
        id: `si_${index}`,
        price: { id: `price_${product}`, product },
      })),
    },
  } as unknown as Stripe.Subscription;
}

function buildEvent(
  type: string,
  subscription: Stripe.Subscription,
  previousAttributes?: Record<string, unknown>
): Stripe.Event {
  return {
    id: "evt_1",
    type,
    data: { object: subscription, previous_attributes: previousAttributes },
  } as unknown as Stripe.Event;
}

/** What the event parser returns for a tier subscription, bundled or not. */
function parsedTierSubscription(subscription: Stripe.Subscription) {
  const productIds = subscription.items.data.map((item) =>
    typeof item.price.product === "string" ? item.price.product : ""
  );
  return {
    subscription,
    customerId: "cus_1",
    tierId: "tier_2",
    productType: undefined,
    product: { id: TEAM_PRODUCT, metadata: { shelf_tier: "tier_2" } },
    hasAuditAddon: productIds.includes(AUDITS_PRODUCT),
    hasBarcodeAddon: productIds.includes(BARCODES_PRODUCT),
  };
}

/** What the event parser returns for a standalone add-on subscription. */
function parsedAddonSubscription(subscription: Stripe.Subscription) {
  return {
    subscription,
    customerId: "cus_1",
    tierId: undefined,
    productType: "addon",
    product: {
      id: BARCODES_PRODUCT,
      metadata: { product_type: "addon", addon_type: "barcodes" },
    },
    hasAuditAddon: false,
    hasBarcodeAddon: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserUpdate.mockResolvedValue({ id: "user-1" });
  mockOrgUpdate.mockResolvedValue({ id: "org-1" });
});

describe("handleSubscriptionPaused", () => {
  it("pauses the add-ons bundled on a tier subscription and still downgrades the user", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      status: "paused",
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionPaused(
      buildEvent("customer.subscription.paused", subscription),
      user
    );

    expect(mockBarcodeAddonWebhook).toHaveBeenCalledWith({
      eventType: "customer.subscription.paused",
      subscription,
      organizationId: "org-1",
    });
    expect(mockAuditAddonWebhook).not.toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tierId: "free" } })
    );
  });

  it("leaves the add-on handlers alone for a tier-only subscription", async () => {
    const subscription = buildSubscription({ status: "paused" });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionPaused(
      buildEvent("customer.subscription.paused", subscription),
      user
    );

    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
    expect(mockAuditAddonWebhook).not.toHaveBeenCalled();
  });

  it("does nothing for bundled add-ons that were never linked to a workspace", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      status: "paused",
      metadata: {},
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionPaused(
      buildEvent("customer.subscription.paused", subscription),
      user
    );

    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
  });

  it("keeps routing a standalone add-on subscription to its handler without touching the tier", async () => {
    const subscription = buildSubscription({
      productIds: [BARCODES_PRODUCT],
      status: "paused",
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedAddonSubscription(subscription)
    );

    await handleSubscriptionPaused(
      buildEvent("customer.subscription.paused", subscription),
      user
    );

    expect(mockBarcodeAddonWebhook).toHaveBeenCalledTimes(1);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe("handleSubscriptionDeleted", () => {
  it("cancels every add-on bundled on the tier subscription", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, AUDITS_PRODUCT, BARCODES_PRODUCT],
      status: "canceled",
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionDeleted(
      buildEvent("customer.subscription.deleted", subscription),
      user
    );

    expect(mockAuditAddonWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer.subscription.deleted",
        organizationId: "org-1",
      })
    );
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer.subscription.deleted",
        organizationId: "org-1",
      })
    );
  });

  it("keeps the add-ons when the cancellation is one side of a transfer", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      status: "canceled",
      metadata: {
        organizationId: "org-1",
        transferred_to_subscription: "sub_2",
      },
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionDeleted(
      buildEvent("customer.subscription.deleted", subscription),
      user
    );

    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
  });
});

describe("handleSubscriptionUpdated", () => {
  it("passes the tier subscription's status change on to its bundled add-ons", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      status: "past_due",
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionUpdated(
      buildEvent("customer.subscription.updated", subscription, {
        status: "active",
      }),
      user
    );

    expect(mockBarcodeAddonWebhook).toHaveBeenCalledWith({
      eventType: "customer.subscription.updated",
      subscription,
      organizationId: "org-1",
    });
  });

  it("switches off an add-on whose line item was removed from the subscription", async () => {
    const subscription = buildSubscription({ productIds: [TEAM_PRODUCT] });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );
    mockProductsRetrieve.mockResolvedValue({
      id: BARCODES_PRODUCT,
      metadata: { product_type: "addon", addon_type: "barcodes" },
    });

    await handleSubscriptionUpdated(
      buildEvent("customer.subscription.updated", subscription, {
        items: {
          data: buildSubscription({
            productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
          }).items.data,
        },
      }),
      user
    );

    expect(mockProductsRetrieve).toHaveBeenCalledWith(BARCODES_PRODUCT);
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { barcodesEnabled: false },
      select: { id: true },
    });
    // The add-on is no longer on the subscription, so its handler is not run.
    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
  });

  it("ignores item updates that keep the same products", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
    });
    mockGetDataFromStripeEvent.mockResolvedValue(
      parsedTierSubscription(subscription)
    );

    await handleSubscriptionUpdated(
      buildEvent("customer.subscription.updated", subscription, {
        items: { data: subscription.items.data },
      }),
      user
    );

    expect(mockProductsRetrieve).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledTimes(1);
  });
});
