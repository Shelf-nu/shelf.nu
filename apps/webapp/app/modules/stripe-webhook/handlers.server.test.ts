/**
 * Stripe webhook handlers — add-ons bundled on a tier subscription.
 *
 * A Team trial or checkout can carry the Audits and Barcodes add-ons as extra
 * line items on the tier subscription. Once workspace creation has linked that
 * subscription to an organization, the organization's add-on flags follow the
 * subscription's lifecycle exactly as they do for a standalone add-on
 * subscription: paused or cancelled means off, an item dropped from the
 * subscription means off, and the add-on handlers see every status change.
 *
 * The event parser runs for real. The Stripe SDK is replaced at the product
 * lookup, so each test states which products the subscription's line items
 * resolve to, and the suite proves that bundled products reach the add-on
 * handlers through the same parsing as in production.
 */
import { TierId } from "@prisma/client";
import Stripe from "stripe";
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

// why: the Stripe SDK makes external API calls. Only the client is replaced:
// `~/utils/stripe.server` stays real, so its event parser resolves line items
// to tier and add-on products through this product lookup, and the check for
// the customer's other subscriptions runs through this subscription list. The
// SDK's error classes are kept so the handlers can tell a missing product
// from a transient failure.
const {
  mockProductsRetrieve,
  mockSubscriptionsList,
  mockSubscriptionsRetrieve,
} = vi.hoisted(() => ({
  mockProductsRetrieve: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockSubscriptionsRetrieve: vi.fn(),
}));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof Stripe }>();
  const client = {
    products: { retrieve: mockProductsRetrieve },
    subscriptions: {
      list: mockSubscriptionsList,
      retrieve: mockSubscriptionsRetrieve,
      update: vi.fn(),
    },
  };
  return {
    ...actual,
    default: Object.assign(
      vi.fn().mockImplementation(() => client),
      { errors: actual.default.errors }
    ),
  };
});

// why: the customer and invoice helpers reach Stripe endpoints the mocked
// client does not provide; the handlers under test never need their result
vi.mock(import("~/utils/stripe.server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    customerHasPaymentMethod: vi.fn(),
    fetchStripeSubscription: vi.fn(),
    getCustomerActiveSubscription: vi.fn(),
    getCustomerNotificationData: vi.fn(),
    getInvoiceNotificationData: vi.fn(),
    getStripeCustomer: vi.fn(),
  };
});

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
  getOrganizationByUserId: vi.fn(),
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
const BARCODES_PRODUCT_V2 = "prod_barcodes_v2";
const AUDITS_PRODUCT = "prod_audits";

/** The Stripe products the line items resolve to, keyed by product id. */
const PRODUCTS: Record<
  string,
  { id: string; metadata: Record<string, string> }
> = {
  [TEAM_PRODUCT]: { id: TEAM_PRODUCT, metadata: { shelf_tier: "tier_2" } },
  [AUDITS_PRODUCT]: {
    id: AUDITS_PRODUCT,
    metadata: { product_type: "addon", addon_type: "audits" },
  },
  [BARCODES_PRODUCT]: {
    id: BARCODES_PRODUCT,
    metadata: { product_type: "addon", addon_type: "barcodes" },
  },
  [BARCODES_PRODUCT_V2]: {
    id: BARCODES_PRODUCT_V2,
    metadata: { product_type: "addon", addon_type: "barcodes" },
  },
};

/** The error Stripe raises for a product id it does not know. */
function missingProductError(productId: string) {
  return new Stripe.errors.StripeInvalidRequestError({
    message: `No such product: '${productId}'`,
    code: "resource_missing",
  });
}

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
        plan: { product },
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

/** The product ids looked up on Stripe, in call order. */
function productLookups() {
  return mockProductsRetrieve.mock.calls.map(([productId]) => productId);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserUpdate.mockResolvedValue({ id: "user-1" });
  mockOrgUpdate.mockResolvedValue({ id: "org-1" });
  // The customer holds no other subscription unless a test says otherwise.
  mockSubscriptionsList.mockResolvedValue({ data: [], has_more: false });
  mockProductsRetrieve.mockImplementation((productId: string) => {
    const product = PRODUCTS[productId];
    return product
      ? Promise.resolve(product)
      : Promise.reject(missingProductError(productId));
  });
});

describe("handleSubscriptionPaused", () => {
  it("pauses the add-ons bundled on a tier subscription and still downgrades the user", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      status: "paused",
    });

    await handleSubscriptionPaused(
      buildEvent("customer.subscription.paused", subscription),
      user
    );

    // The add-on is found by resolving the line items to Stripe products.
    expect(productLookups()).toEqual([TEAM_PRODUCT, BARCODES_PRODUCT]);
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

    await handleSubscriptionDeleted(
      buildEvent("customer.subscription.deleted", subscription),
      user
    );

    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
  });

  it("hands a cancelled standalone add-on subscription to its handler", async () => {
    const subscription = buildSubscription({
      productIds: [BARCODES_PRODUCT],
      status: "canceled",
    });

    await handleSubscriptionDeleted(
      buildEvent("customer.subscription.deleted", subscription),
      user
    );

    // The handler needs the subscription to check the customer's other
    // subscriptions before switching the add-on off.
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledWith({
      eventType: "customer.subscription.deleted",
      subscription,
      organizationId: "org-1",
    });
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

describe("handleSubscriptionUpdated", () => {
  it("passes the tier subscription's status change on to its bundled add-ons", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      status: "past_due",
    });

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

  it("keeps a removed add-on on while another live subscription still carries it", async () => {
    const subscription = buildSubscription({ productIds: [TEAM_PRODUCT] });
    const standalone = {
      id: "sub_standalone",
      status: "active",
      metadata: { organizationId: "org-1" },
      items: { data: [{ price: { product: PRODUCTS[BARCODES_PRODUCT] } }] },
    };
    mockSubscriptionsList.mockResolvedValue({
      data: [{ id: standalone.id }],
      has_more: false,
    });
    mockSubscriptionsRetrieve.mockResolvedValue(standalone);

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

    expect(mockSubscriptionsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1" })
    );
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("keeps an add-on whose product was swapped for another product of the same add-on", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT_V2],
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

    // The bundled sync still reaches the handler; nothing is switched off and
    // the customer's other subscriptions are not even consulted.
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledTimes(1);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
  });

  it("ignores item updates that keep the same products", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
    });

    await handleSubscriptionUpdated(
      buildEvent("customer.subscription.updated", subscription, {
        items: { data: subscription.items.data },
      }),
      user
    );

    // Only the parser's lookups; nothing was resolved for the removal check.
    expect(productLookups()).toEqual([TEAM_PRODUCT, BARCODES_PRODUCT]);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledTimes(1);
  });

  it("skips a removed item whose product Stripe no longer knows and still handles the rest", async () => {
    const subscription = buildSubscription({ productIds: [TEAM_PRODUCT] });

    const response = await handleSubscriptionUpdated(
      buildEvent("customer.subscription.updated", subscription, {
        items: {
          data: buildSubscription({
            productIds: [TEAM_PRODUCT, "prod_gone", BARCODES_PRODUCT],
          }).items.data,
        },
      }),
      user
    );

    expect(response.status).toBe(200);
    expect(mockOrgUpdate).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { barcodesEnabled: false },
      select: { id: true },
    });
  });

  it("rethrows any other product lookup failure so Stripe retries the webhook", async () => {
    const subscription = buildSubscription({ productIds: [TEAM_PRODUCT] });
    mockProductsRetrieve.mockImplementation((productId: string) =>
      productId === "prod_flaky"
        ? Promise.reject(
            new Stripe.errors.StripeConnectionError({
              message: "An error occurred with our connection to Stripe.",
            })
          )
        : Promise.resolve(PRODUCTS[productId])
    );

    await expect(
      handleSubscriptionUpdated(
        buildEvent("customer.subscription.updated", subscription, {
          items: {
            data: buildSubscription({
              productIds: [TEAM_PRODUCT, "prod_flaky", BARCODES_PRODUCT],
            }).items.data,
          },
        }),
        user
      )
    ).rejects.toBeInstanceOf(Stripe.errors.StripeConnectionError);

    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});
