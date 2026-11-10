/**
 * Stripe webhook handlers: add-ons bundled on a tier subscription, and the
 * plan a tier subscription grants when it changes.
 *
 * A Team trial or checkout can carry the Audits and Barcodes add-ons as extra
 * line items on the tier subscription. Once workspace creation has linked that
 * subscription to an organization, the organization's add-on flags follow the
 * subscription's lifecycle exactly as they do for a standalone add-on
 * subscription: paused, cancelled or overdue means off, an item dropped from
 * the subscription means off, and the add-on handlers see every status change.
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
    ADMIN_EMAIL: "admin@example.com",
    CUSTOM_INSTALL_CUSTOMERS: "",
    SERVER_URL: "https://app.shelf.nu",
  };
});

// why: Database module connects to Prisma during import
const { mockUserUpdate, mockOrgUpdate, mockOrgFindMany, mockOrgCount } =
  vi.hoisted(() => ({
    mockUserUpdate: vi.fn(),
    mockOrgUpdate: vi.fn(),
    mockOrgFindMany: vi.fn(),
    mockOrgCount: vi.fn(),
  }));
vi.mock("~/database/db.server", () => ({
  db: {
    user: { update: mockUserUpdate },
    organization: {
      update: mockOrgUpdate,
      findMany: mockOrgFindMany,
      count: mockOrgCount,
    },
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
  mockSubscriptionsUpdate,
} = vi.hoisted(() => ({
  mockProductsRetrieve: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockSubscriptionsRetrieve: vi.fn(),
  mockSubscriptionsUpdate: vi.fn(),
}));
vi.mock("stripe", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof Stripe }>();
  const client = {
    products: { retrieve: mockProductsRetrieve },
    subscriptions: {
      list: mockSubscriptionsList,
      retrieve: mockSubscriptionsRetrieve,
      update: mockSubscriptionsUpdate,
    },
  };
  return {
    ...actual,
    default: Object.assign(
      // A `function`, not an arrow: the module calls `new Stripe(...)`, and an
      // arrow-function mock implementation cannot be called with `new`.
      vi.fn().mockImplementation(function () {
        return client;
      }),
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
const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));
vi.mock("~/emails/mail.server", () => ({ sendEmail: mockSendEmail }));
vi.mock("~/emails/stripe/audit-trial-ends-soon", () => ({
  sendAuditTrialEndsSoonEmail: vi.fn(),
}));
vi.mock("~/emails/stripe/barcode-trial-ends-soon", () => ({
  sendBarcodeTrialEndsSoonEmail: vi.fn(),
}));
const { mockSubscriptionGrantedText } = vi.hoisted(() => ({
  mockSubscriptionGrantedText: vi.fn(),
}));
vi.mock("~/emails/stripe/subscription-granted", () => ({
  subscriptionGrantedText: mockSubscriptionGrantedText,
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
  fetchStripeSubscription,
  getCustomerNotificationData,
  getInvoiceNotificationData,
} from "~/utils/stripe.server";
import {
  handleInvoiceOverdue,
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
  handleSubscriptionPaused,
  handleSubscriptionUpdated,
} from "./handlers.server";
import type { WebhookUser } from "./helpers.server";

const TEAM_PRODUCT = "prod_team";
const PLUS_PRODUCT = "prod_plus";
const BARCODES_PRODUCT = "prod_barcodes";
const BARCODES_PRODUCT_V2 = "prod_barcodes_v2";
const AUDITS_PRODUCT = "prod_audits";

/** The Stripe products the line items resolve to, keyed by product id. */
const PRODUCTS: Record<
  string,
  { id: string; metadata: Record<string, string> }
> = {
  [TEAM_PRODUCT]: { id: TEAM_PRODUCT, metadata: { shelf_tier: "tier_2" } },
  [PLUS_PRODUCT]: { id: PLUS_PRODUCT, metadata: { shelf_tier: "tier_1" } },
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
  skipSubscriptionCheck: false,
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

/** A customer subscription as Stripe holds it now, products expanded. */
function storedSubscription(
  productIds: string[],
  {
    id = "sub_1",
    status = "active",
    metadata = {},
  }: { id?: string; status?: string; metadata?: Record<string, string> } = {}
) {
  return {
    id,
    status,
    metadata,
    items: {
      data: productIds.map((productId) => ({
        price: { product: PRODUCTS[productId] },
      })),
    },
  };
}

/** Makes Stripe list exactly these subscriptions for the customer. */
function stripeHolds(
  ...subscriptions: { id: string; [key: string]: unknown }[]
) {
  mockSubscriptionsList.mockResolvedValue({
    data: subscriptions.map(({ id }) => ({ id })),
    has_more: false,
  });
  mockSubscriptionsRetrieve.mockImplementation((id: string) =>
    Promise.resolve(subscriptions.find((sub) => sub.id === id))
  );
}

/** The subjects of the emails sent to the admin. */
function adminEmailSubjects() {
  return mockSendEmail.mock.calls
    .map(([email]) => email)
    .filter((email) => email.to === "admin@example.com")
    .map((email) => email.subject as string);
}

/** The product ids looked up on Stripe, in call order. */
function productLookups() {
  return mockProductsRetrieve.mock.calls.map(([productId]) => productId);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserUpdate.mockResolvedValue({ id: "user-1" });
  mockOrgUpdate.mockResolvedValue({ id: "org-1" });
  // The customer holds no other subscription and owns no Team workspace
  // unless a test says otherwise.
  mockSubscriptionsList.mockResolvedValue({ data: [], has_more: false });
  mockOrgFindMany.mockResolvedValue([]);
  mockOrgCount.mockResolvedValue(0);
  mockProductsRetrieve.mockImplementation((productId: string) => {
    const product = PRODUCTS[productId];
    return product
      ? Promise.resolve(product)
      : Promise.reject(missingProductError(productId));
  });
});

describe("handleSubscriptionCreated", () => {
  beforeEach(() => {
    vi.mocked(getCustomerNotificationData).mockResolvedValue({
      emailsToNotify: new Set(["owner@example.com"]),
      customerName: "Alice",
    });
  });

  it("switches on the add-ons bundled on a subscription created with a workspace", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, AUDITS_PRODUCT, BARCODES_PRODUCT],
    });

    await handleSubscriptionCreated(
      buildEvent("customer.subscription.created", subscription),
      user
    );

    expect(mockAuditAddonWebhook).toHaveBeenCalledWith({
      eventType: "customer.subscription.created",
      subscription,
      organizationId: "org-1",
    });
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledWith({
      eventType: "customer.subscription.created",
      subscription,
      organizationId: "org-1",
    });
  });

  it("leaves the add-ons of a subscription that is not live yet to the update that activates it", async () => {
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, AUDITS_PRODUCT],
      status: "incomplete",
    });

    await handleSubscriptionCreated(
      buildEvent("customer.subscription.created", subscription),
      user
    );

    expect(mockAuditAddonWebhook).not.toHaveBeenCalled();
  });

  describe("a Team subscription created without a workspace", () => {
    const unlinked = () =>
      buildSubscription({
        productIds: [TEAM_PRODUCT, AUDITS_PRODUCT],
        metadata: {},
      });

    it("stays unlinked and asks the customer to create a workspace when they own none", async () => {
      await handleSubscriptionCreated(
        buildEvent("customer.subscription.created", unlinked()),
        user
      );

      expect(mockOrgFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: "user-1", type: "TEAM" } })
      );
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
      expect(mockAuditAddonWebhook).not.toHaveBeenCalled();
      expect(adminEmailSubjects()).toEqual([]);
      expect(mockSubscriptionGrantedText).toHaveBeenCalledWith(
        expect.objectContaining({ needsTeamWorkspace: true })
      );
    });

    it("is linked to the one Team workspace the customer owns, with its add-ons", async () => {
      mockOrgFindMany.mockResolvedValue([
        { id: "org-9", name: "ZZ Test Team" },
      ]);
      mockOrgCount.mockResolvedValue(1);

      await handleSubscriptionCreated(
        buildEvent("customer.subscription.created", unlinked()),
        user
      );

      expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
        metadata: { organizationId: "org-9" },
      });
      expect(mockAuditAddonWebhook).toHaveBeenCalledWith({
        eventType: "customer.subscription.created",
        subscription: expect.objectContaining({
          metadata: { organizationId: "org-9" },
        }),
        organizationId: "org-9",
      });
      expect(adminEmailSubjects()).toEqual([
        "Activated: plan + add-ons linked to ZZ Test Team",
      ]);
      expect(mockSubscriptionGrantedText).toHaveBeenCalledWith(
        expect.objectContaining({ needsTeamWorkspace: false })
      );
    });

    it("asks the admin to pick when the customer owns several Team workspaces", async () => {
      mockOrgFindMany.mockResolvedValue([
        { id: "org-8", name: "ZZ Test Team A" },
        { id: "org-9", name: "ZZ Test Team B" },
      ]);
      mockOrgCount.mockResolvedValue(2);

      await handleSubscriptionCreated(
        buildEvent("customer.subscription.created", unlinked()),
        user
      );

      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
      expect(mockAuditAddonWebhook).not.toHaveBeenCalled();
      expect(adminEmailSubjects()).toEqual([
        "Needs you: customer owns 2 Team workspaces, pick one in Stripe metadata",
      ]);
      const adminEmail = mockSendEmail.mock.calls.find(
        ([email]) => email.to === "admin@example.com"
      )?.[0];
      expect(adminEmail.text).toContain("org-8");
      expect(adminEmail.text).toContain("org-9");
    });

    it("skips a workspace another live plan subscription is linked to", async () => {
      stripeHolds(
        storedSubscription([TEAM_PRODUCT], {
          id: "sub_other",
          metadata: { organizationId: "org-8" },
        }),
        storedSubscription([TEAM_PRODUCT, AUDITS_PRODUCT])
      );
      mockOrgFindMany.mockResolvedValue([
        { id: "org-8", name: "ZZ Test Team A" },
        { id: "org-9", name: "ZZ Test Team B" },
      ]);

      await handleSubscriptionCreated(
        buildEvent("customer.subscription.created", unlinked()),
        user
      );

      expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
        metadata: { organizationId: "org-9" },
      });
    });

    it("still counts a workspace that only a standalone add-on subscription or a paused plan names", async () => {
      stripeHolds(
        storedSubscription([AUDITS_PRODUCT], {
          id: "sub_standalone",
          metadata: { organizationId: "org-8" },
        }),
        storedSubscription([TEAM_PRODUCT], {
          id: "sub_paused",
          status: "paused",
          metadata: { organizationId: "org-9" },
        }),
        storedSubscription([TEAM_PRODUCT, AUDITS_PRODUCT])
      );
      mockOrgFindMany.mockResolvedValue([
        { id: "org-8", name: "ZZ Test Team A" },
        { id: "org-9", name: "ZZ Test Team B" },
      ]);

      await handleSubscriptionCreated(
        buildEvent("customer.subscription.created", unlinked()),
        user
      );

      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
      expect(adminEmailSubjects()).toEqual([
        "Needs you: customer owns 2 Team workspaces, pick one in Stripe metadata",
      ]);
    });

    it("leaves a subscription alone that Stripe already shows linked (a retried event)", async () => {
      stripeHolds(
        storedSubscription([TEAM_PRODUCT, AUDITS_PRODUCT], {
          metadata: { organizationId: "org-9" },
        })
      );
      mockOrgFindMany.mockResolvedValue([
        { id: "org-9", name: "ZZ Test Team" },
      ]);

      await handleSubscriptionCreated(
        buildEvent("customer.subscription.created", unlinked()),
        user
      );

      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
      expect(adminEmailSubjects()).toEqual([]);
    });

    it("does not link a Plus subscription", async () => {
      mockOrgFindMany.mockResolvedValue([
        { id: "org-9", name: "ZZ Test Team" },
      ]);

      await handleSubscriptionCreated(
        buildEvent(
          "customer.subscription.created",
          buildSubscription({ productIds: [PLUS_PRODUCT], metadata: {} })
        ),
        { ...user, tierId: TierId.free }
      );

      expect(mockOrgFindMany).not.toHaveBeenCalled();
      expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
      expect(mockSubscriptionGrantedText).toHaveBeenCalledWith(
        expect.objectContaining({ needsTeamWorkspace: false })
      );
    });
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

  it("keeps Team while another live Team subscription still pays for it", async () => {
    stripeHolds(
      storedSubscription([TEAM_PRODUCT], {
        id: "sub_2",
        metadata: { organizationId: "org-2" },
      })
    );

    await handleSubscriptionPaused(
      buildEvent(
        "customer.subscription.paused",
        buildSubscription({ status: "paused" })
      ),
      user
    );

    expect(mockUserUpdate).not.toHaveBeenCalled();
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

  it("keeps Team when another Team subscription still pays for it", async () => {
    stripeHolds(
      storedSubscription([TEAM_PRODUCT], {
        id: "sub_2",
        metadata: { organizationId: "org-2" },
      })
    );

    await handleSubscriptionDeleted(
      buildEvent(
        "customer.subscription.deleted",
        buildSubscription({ status: "canceled" })
      ),
      user
    );

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("lowers the user to the plan their remaining subscription grants", async () => {
    stripeHolds(storedSubscription([PLUS_PRODUCT], { id: "sub_2" }));

    await handleSubscriptionDeleted(
      buildEvent(
        "customer.subscription.deleted",
        buildSubscription({ status: "canceled" })
      ),
      user
    );

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tierId: "tier_1" } })
    );
  });

  it("lowers the user to Free when no other subscription grants a plan", async () => {
    await handleSubscriptionDeleted(
      buildEvent(
        "customer.subscription.deleted",
        buildSubscription({ status: "canceled" })
      ),
      user
    );

    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tierId: "free" } })
    );
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
  it("links a Team subscription without a workspace when it goes live", async () => {
    mockOrgFindMany.mockResolvedValue([{ id: "org-9", name: "ZZ Test Team" }]);
    const subscription = buildSubscription({
      productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
      metadata: {},
    });

    await handleSubscriptionUpdated(
      buildEvent("customer.subscription.updated", subscription, {
        status: "incomplete",
      }),
      user
    );

    expect(mockSubscriptionsUpdate).toHaveBeenCalledWith("sub_1", {
      metadata: { organizationId: "org-9" },
    });
    expect(mockBarcodeAddonWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "customer.subscription.updated",
        organizationId: "org-9",
      })
    );
  });

  it("does not look for a workspace on an update of a subscription that was already live", async () => {
    mockOrgFindMany.mockResolvedValue([{ id: "org-9", name: "ZZ Test Team" }]);

    await handleSubscriptionUpdated(
      buildEvent(
        "customer.subscription.updated",
        buildSubscription({ metadata: {} }),
        { current_period_end: 1 }
      ),
      user
    );

    expect(mockOrgFindMany).not.toHaveBeenCalled();
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });
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

  describe("plan changes", () => {
    /** An update that swapped the Team item for a Plus item, as the billing portal does. */
    function teamToPlusEvent() {
      return buildEvent(
        "customer.subscription.updated",
        buildSubscription({ productIds: [PLUS_PRODUCT], metadata: {} }),
        {
          items: {
            data: buildSubscription({ productIds: [TEAM_PRODUCT] }).items.data,
          },
        }
      );
    }

    /** The event's subscription as Stripe holds it now, products expanded. */
    function liveSubscription(
      productId: string,
      { id = "sub_1", status = "active" }: { id?: string; status?: string } = {}
    ) {
      return {
        id,
        status,
        metadata: {},
        items: { data: [{ price: { product: PRODUCTS[productId] } }] },
      };
    }

    /** The customer's subscriptions as Stripe lists them now. */
    function customerHolds(
      ...subscriptions: { id: string; [key: string]: unknown }[]
    ) {
      mockSubscriptionsList.mockResolvedValue({
        data: subscriptions.map(({ id }) => ({ id })),
        has_more: false,
      });
      mockSubscriptionsRetrieve.mockImplementation((id: string) =>
        Promise.resolve(subscriptions.find((sub) => sub.id === id))
      );
    }

    /** An update that moved the plan item from one product to another. */
    function planSwitchEvent({
      from,
      to,
      status = "active",
      metadata = {},
    }: {
      from: string;
      to: string;
      status?: Stripe.Subscription.Status;
      metadata?: Record<string, string>;
    }) {
      return buildEvent(
        "customer.subscription.updated",
        buildSubscription({ productIds: [to], status, metadata }),
        {
          items: {
            data: buildSubscription({ productIds: [from] }).items.data,
          },
        }
      );
    }

    it("lowers the plan when the subscription moved from Team to Plus", async () => {
      mockSubscriptionsList.mockResolvedValue({
        data: [{ id: "sub_1" }],
        has_more: false,
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription(PLUS_PRODUCT)
      );

      await handleSubscriptionUpdated(teamToPlusEvent(), user);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { customerId: "cus_1" },
        data: { tierId: TierId.tier_1 },
        select: { id: true },
      });
    });

    it("ignores a late Team to Plus event once the subscription is back on Team", async () => {
      mockSubscriptionsList.mockResolvedValue({
        data: [{ id: "sub_1" }],
        has_more: false,
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription(TEAM_PRODUCT)
      );

      await handleSubscriptionUpdated(teamToPlusEvent(), user);

      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("lowers to Free when a late Team to Plus event finds the subscription cancelled since", async () => {
      // The customer holds no live subscription any more (the default list).
      await handleSubscriptionUpdated(teamToPlusEvent(), user);

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { customerId: "cus_1" },
        data: { tierId: TierId.free },
        select: { id: true },
      });
    });

    it("looks the removed plan product up once when the subscription is linked to a workspace", async () => {
      mockSubscriptionsList.mockResolvedValue({
        data: [{ id: "sub_1" }],
        has_more: false,
      });
      mockSubscriptionsRetrieve.mockResolvedValue(
        liveSubscription(PLUS_PRODUCT)
      );

      await handleSubscriptionUpdated(
        buildEvent(
          "customer.subscription.updated",
          buildSubscription({ productIds: [PLUS_PRODUCT] }),
          {
            items: {
              data: buildSubscription({ productIds: [TEAM_PRODUCT] }).items
                .data,
            },
          }
        ),
        user
      );

      // The parser resolves the plan now, then the add-on and plan checks
      // share one lookup of the plan that was removed.
      expect(productLookups()).toEqual([PLUS_PRODUCT, TEAM_PRODUCT]);
      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tierId: TierId.tier_1 } })
      );
    });

    it("leaves a Custom plan alone when its subscription moves down", async () => {
      await handleSubscriptionUpdated(teamToPlusEvent(), {
        ...user,
        tierId: TierId.custom,
      });

      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("keeps Team while another live subscription still pays for it", async () => {
      const secondTeam = {
        id: "sub_second_team",
        status: "active",
        metadata: { organizationId: "org-2" },
        items: { data: [{ price: { product: PRODUCTS[TEAM_PRODUCT] } }] },
      };
      mockSubscriptionsList.mockResolvedValue({
        data: [{ id: secondTeam.id }],
        has_more: false,
      });
      mockSubscriptionsRetrieve.mockResolvedValue(secondTeam);

      await handleSubscriptionUpdated(teamToPlusEvent(), user);

      expect(mockSubscriptionsList).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_1" })
      );
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("does not touch the plan when the update kept the plan item", async () => {
      const subscription = buildSubscription({ productIds: [TEAM_PRODUCT] });

      await handleSubscriptionUpdated(
        buildEvent("customer.subscription.updated", subscription, {
          items: { data: subscription.items.data },
        }),
        user
      );

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockSubscriptionsList).not.toHaveBeenCalled();
    });

    it("leaves a plan support manages by hand alone when its subscription moves down", async () => {
      await handleSubscriptionUpdated(teamToPlusEvent(), {
        ...user,
        skipSubscriptionCheck: true,
      });

      expect(mockUserUpdate).not.toHaveBeenCalled();
      expect(mockSubscriptionsList).not.toHaveBeenCalled();
    });

    it.each(["trialing", "past_due"] as const)(
      "lowers the plan for a %s subscription that moved from Team to Plus",
      async (status) => {
        customerHolds(liveSubscription(PLUS_PRODUCT, { status }));

        await handleSubscriptionUpdated(
          planSwitchEvent({ from: TEAM_PRODUCT, to: PLUS_PRODUCT, status }),
          user
        );

        expect(mockUserUpdate).toHaveBeenCalledWith(
          expect.objectContaining({ data: { tierId: TierId.tier_1 } })
        );
      }
    );

    it.each(["canceled", "unpaid", "incomplete_expired", "paused"] as const)(
      "leaves the plan to the lifecycle handlers when the moved subscription is %s",
      async (status) => {
        await handleSubscriptionUpdated(
          planSwitchEvent({ from: TEAM_PRODUCT, to: PLUS_PRODUCT, status }),
          user
        );

        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockSubscriptionsList).not.toHaveBeenCalled();
      }
    );

    it("does not count a live Team subscription that grants no plan", async () => {
      customerHolds(
        liveSubscription(PLUS_PRODUCT),
        liveSubscription(TEAM_PRODUCT, {
          id: "sub_unpaid_team",
          status: "incomplete",
        })
      );

      await handleSubscriptionUpdated(teamToPlusEvent(), user);

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tierId: TierId.tier_1 } })
      );
    });

    it("does not count an add-on product as a plan, even one carrying a tier", async () => {
      customerHolds({
        id: "sub_1",
        status: "active",
        metadata: {},
        items: {
          data: [
            { price: { product: PRODUCTS[PLUS_PRODUCT] } },
            {
              price: {
                product: {
                  id: "prod_tagged_addon",
                  metadata: {
                    product_type: "addon",
                    addon_type: "audits",
                    shelf_tier: "tier_2",
                  },
                },
              },
            },
          ],
        },
      });

      await handleSubscriptionUpdated(teamToPlusEvent(), user);

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tierId: TierId.tier_1 } })
      );
    });

    it("reads the customer's subscriptions once when an update drops an add-on and lowers the plan", async () => {
      customerHolds(liveSubscription(PLUS_PRODUCT));

      await handleSubscriptionUpdated(
        buildEvent(
          "customer.subscription.updated",
          buildSubscription({ productIds: [PLUS_PRODUCT] }),
          {
            items: {
              data: buildSubscription({
                productIds: [TEAM_PRODUCT, AUDITS_PRODUCT],
              }).items.data,
            },
          }
        ),
        user
      );

      expect(mockOrgUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { auditsEnabled: false } })
      );
      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tierId: TierId.tier_1 } })
      );
      expect(mockSubscriptionsList).toHaveBeenCalledTimes(1);
    });

    it("looks nothing up for an update of a subscription with no workspace that cannot lower the plan", async () => {
      await handleSubscriptionUpdated(
        planSwitchEvent({ from: TEAM_PRODUCT, to: PLUS_PRODUCT }),
        { ...user, tierId: TierId.tier_1 }
      );

      // Only the event parser's lookup of the plan the subscription has now.
      expect(productLookups()).toEqual([PLUS_PRODUCT]);
      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it("raises the plan when an active subscription moved from Plus to Team", async () => {
      customerHolds(liveSubscription(TEAM_PRODUCT));

      await handleSubscriptionUpdated(
        planSwitchEvent({ from: PLUS_PRODUCT, to: TEAM_PRODUCT }),
        { ...user, tierId: TierId.tier_1 }
      );

      expect(mockUserUpdate).toHaveBeenCalledWith({
        where: { customerId: "cus_1" },
        data: { tierId: TierId.tier_2 },
        select: { id: true },
      });
    });

    it("raises the plan no further than the event's tier", async () => {
      customerHolds(liveSubscription(TEAM_PRODUCT), {
        id: "sub_custom",
        status: "active",
        metadata: {},
        items: {
          data: [
            {
              price: {
                product: {
                  id: "prod_custom",
                  metadata: { shelf_tier: "custom" },
                },
              },
            },
          ],
        },
      });

      await handleSubscriptionUpdated(
        planSwitchEvent({ from: PLUS_PRODUCT, to: TEAM_PRODUCT }),
        { ...user, tierId: TierId.tier_1 }
      );

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { tierId: TierId.tier_2 } })
      );
    });

    it("ignores a late Plus to Team event once the subscription is back on Plus", async () => {
      customerHolds(liveSubscription(PLUS_PRODUCT));

      await handleSubscriptionUpdated(
        planSwitchEvent({ from: PLUS_PRODUCT, to: TEAM_PRODUCT }),
        { ...user, tierId: TierId.tier_1 }
      );

      expect(mockUserUpdate).not.toHaveBeenCalled();
    });

    it.each(["trialing", "past_due"] as const)(
      "does not raise the plan for a %s subscription that moved from Plus to Team",
      async (status) => {
        await handleSubscriptionUpdated(
          planSwitchEvent({ from: PLUS_PRODUCT, to: TEAM_PRODUCT, status }),
          { ...user, tierId: TierId.tier_1 }
        );

        expect(mockUserUpdate).not.toHaveBeenCalled();
        expect(mockSubscriptionsList).not.toHaveBeenCalled();
      }
    );
  });
});

describe("handleInvoiceOverdue", () => {
  /** The subscription as `fetchStripeSubscription` returns it: products expanded. */
  function withExpandedProducts(subscription: Stripe.Subscription) {
    return {
      ...subscription,
      items: {
        data: subscription.items.data.map((item) => ({
          ...item,
          plan: { product: PRODUCTS[item.plan.product as string] },
        })),
      },
    } as unknown as Awaited<ReturnType<typeof fetchStripeSubscription>>;
  }

  function overdueInvoiceEvent() {
    return {
      id: "evt_1",
      type: "invoice.overdue",
      data: {
        object: {
          id: "in_1",
          parent: { subscription_details: { subscription: "sub_1" } },
        },
      },
    } as unknown as Stripe.Event;
  }

  beforeEach(() => {
    vi.mocked(getInvoiceNotificationData).mockResolvedValue({
      emailsToNotify: [],
    } as unknown as Awaited<ReturnType<typeof getInvoiceNotificationData>>);
  });

  it("ends the add-ons bundled on the overdue tier subscription along with the tier", async () => {
    const subscription = withExpandedProducts(
      buildSubscription({
        productIds: [TEAM_PRODUCT, AUDITS_PRODUCT, BARCODES_PRODUCT],
        status: "past_due",
      })
    );
    vi.mocked(fetchStripeSubscription).mockResolvedValue(subscription);

    await handleInvoiceOverdue(overdueInvoiceEvent(), user, "cus_1");

    for (const handler of [mockAuditAddonWebhook, mockBarcodeAddonWebhook]) {
      expect(handler).toHaveBeenCalledWith({
        eventType: "invoice.overdue",
        subscription,
        organizationId: "org-1",
      });
    }
    expect(mockUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tierId: TierId.free } })
    );
  });

  it("ends an overdue standalone add-on without touching the tier", async () => {
    const subscription = withExpandedProducts(
      buildSubscription({ productIds: [AUDITS_PRODUCT], status: "past_due" })
    );
    vi.mocked(fetchStripeSubscription).mockResolvedValue(subscription);

    await handleInvoiceOverdue(overdueInvoiceEvent(), user, "cus_1");

    expect(mockAuditAddonWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "invoice.overdue" })
    );
    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { tierId: TierId.free } })
    );
  });

  it("leaves add-ons that were never linked to a workspace alone", async () => {
    const subscription = withExpandedProducts(
      buildSubscription({
        productIds: [TEAM_PRODUCT, BARCODES_PRODUCT],
        status: "past_due",
        metadata: {},
      })
    );
    vi.mocked(fetchStripeSubscription).mockResolvedValue(subscription);

    await handleInvoiceOverdue(overdueInvoiceEvent(), user, "cus_1");

    expect(mockBarcodeAddonWebhook).not.toHaveBeenCalled();
  });
});
