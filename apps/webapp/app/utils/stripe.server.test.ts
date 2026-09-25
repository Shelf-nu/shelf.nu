import type Stripe from "stripe";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HARDCODED_DEFAULT_PREFS } from "~/utils/date-format";
import type { CustomerWithSubscriptions } from "./stripe.server";

// why: Stripe SDK makes external API calls that should not run in tests
// Using vi.hoisted to ensure the mock function is available when vi.mock runs
const {
  mockCheckoutSessionsCreate,
  mockCustomersRetrieve,
  mockProductsRetrieve,
  mockSubscriptionsList,
  mockSubscriptionsRetrieve,
} = vi.hoisted(() => ({
  mockCheckoutSessionsCreate: vi.fn(),
  mockCustomersRetrieve: vi.fn(),
  mockProductsRetrieve: vi.fn(),
  mockSubscriptionsList: vi.fn(),
  mockSubscriptionsRetrieve: vi.fn(),
}));

vi.mock("stripe", () => ({
  // A `function`, not an arrow: the module calls `new Stripe(...)`, and an
  // arrow-function mock implementation cannot be called with `new`.
  default: vi.fn().mockImplementation(function () {
    return {
      checkout: { sessions: { create: mockCheckoutSessionsCreate } },
      customers: {
        retrieve: mockCustomersRetrieve,
      },
      products: { retrieve: mockProductsRetrieve },
      subscriptions: {
        list: mockSubscriptionsList,
        retrieve: mockSubscriptionsRetrieve,
      },
    };
  }),
}));

// why: Database module tries to connect to Prisma during import
const { mockUserFindUnique, mockUserUpdate, mockOrganizationFindMany } =
  vi.hoisted(() => ({
    mockUserFindUnique: vi.fn(),
    mockUserUpdate: vi.fn(),
    mockOrganizationFindMany: vi.fn(),
  }));

vi.mock("~/database/db.server", () => ({
  db: {
    organization: { findMany: mockOrganizationFindMany },
    user: {
      update: mockUserUpdate,
      findUnique: mockUserFindUnique,
    },
  },
}));

// Import after mocking
import {
  createStripeCheckoutSession,
  customerHasOtherActiveAddonSubscription,
  findWorkspaceOfPreviousTierSubscription,
  getCustomerNotificationData,
  getInvoiceNotificationData,
  getUserActiveSubscriptions,
  getOwnerSubscriptionInfo,
  validateSubscriptionIsActive,
} from "./stripe.server";

describe("getCustomerNotificationData", () => {
  const baseUser = {
    email: "user@example.com",
    firstName: "John",
    displayName: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should deduplicate emails when Stripe and user email are the same", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "user@example.com",
      name: "John Doe",
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: baseUser,
    });

    expect(result.emailsToNotify.size).toBe(1);
    expect(result.emailsToNotify.has("user@example.com")).toBe(true);
  });

  it("should include both emails when Stripe and user email are different", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "billing@example.com",
      name: "John Doe",
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: baseUser,
    });

    expect(result.emailsToNotify.size).toBe(2);
    expect(result.emailsToNotify.has("billing@example.com")).toBe(true);
    expect(result.emailsToNotify.has("user@example.com")).toBe(true);
  });

  it("should deduplicate emails case-insensitively", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "USER@Example.COM",
      name: "John Doe",
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: baseUser,
    });

    expect(result.emailsToNotify.size).toBe(1);
    expect(result.emailsToNotify.has("user@example.com")).toBe(true);
  });

  it("should use Stripe customer name when available", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "billing@example.com",
      name: "Stripe Customer Name",
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: baseUser,
    });

    expect(result.customerName).toBe("Stripe Customer Name");
  });

  it("should use user firstName when Stripe customer name is null", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "billing@example.com",
      name: null,
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: baseUser,
    });

    expect(result.customerName).toBe("John");
  });

  it("should handle deleted Stripe customer gracefully", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: true,
    } as Stripe.DeletedCustomer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: baseUser,
    });

    // Should only have user email since Stripe customer is deleted
    expect(result.emailsToNotify.size).toBe(1);
    expect(result.emailsToNotify.has("user@example.com")).toBe(true);
    expect(result.customerName).toBe("John");
  });

  it("should handle user with null firstName", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: { email: "user@example.com", firstName: null, displayName: null },
    });

    expect(result.customerName).toBeNull();
  });

  it("greets by displayName in preference to the Stripe customer name", async () => {
    // `customerName` is a salutation, so the name the user chose wins over the
    // legal name we registered with Stripe for invoicing.
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "user@example.com",
      name: "Jonathan Legalname",
    } as unknown as Stripe.Customer);

    const result = await getCustomerNotificationData({
      customerId: "cus_123",
      user: { ...baseUser, displayName: "Jo" },
    });

    expect(result.customerName).toBe("Jo");
  });
});

describe("getInvoiceNotificationData", () => {
  const baseUser = {
    email: "user@example.com",
    firstName: "John",
    displayName: null,
  };

  const baseInvoice = {
    lines: {
      data: [{ description: "Plus Plan - Monthly" }],
    },
    currency: "usd",
    amount_due: 2999,
    due_date: 1704067200, // January 1, 2024
  } as unknown as Stripe.Invoice;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should format amount due correctly", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: baseInvoice,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    expect(result.amountDue).toBe("$29.99");
  });

  it("should format amount due with different currencies", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const euroInvoice = {
      ...baseInvoice,
      currency: "eur",
      amount_due: 5000,
    } as unknown as Stripe.Invoice;

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: euroInvoice,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    // EUR formatting varies by locale, just verify it contains the amount
    expect(result.amountDue).toContain("50");
  });

  it("should format due date correctly", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: baseInvoice,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    expect(result.dueDate).toBe("January 1, 2024");
  });

  it("should return null for due date when invoice has no due_date", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const invoiceWithoutDueDate = {
      ...baseInvoice,
      due_date: null,
    } as unknown as Stripe.Invoice;

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: invoiceWithoutDueDate,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    expect(result.dueDate).toBeNull();
  });

  it("should use fallback subscription name when description is missing", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const invoiceWithoutDescription = {
      ...baseInvoice,
      lines: { data: [{ description: null }] },
    } as unknown as Stripe.Invoice;

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: invoiceWithoutDescription,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    expect(result.subscriptionName).toBe("Shelf Subscription");
  });

  it("should use fallback subscription name when lines data is empty", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: null,
      name: null,
    } as unknown as Stripe.Customer);

    const invoiceWithEmptyLines = {
      ...baseInvoice,
      lines: { data: [] },
    } as unknown as Stripe.Invoice;

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: invoiceWithEmptyLines,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    expect(result.subscriptionName).toBe("Shelf Subscription");
  });

  it("should include customer notification data", async () => {
    mockCustomersRetrieve.mockResolvedValue({
      id: "cus_123",
      deleted: false,
      email: "billing@example.com",
      name: "Stripe Customer Name",
    } as unknown as Stripe.Customer);

    const result = await getInvoiceNotificationData({
      customerId: "cus_123",
      invoice: baseInvoice,
      user: baseUser,
      prefs: HARDCODED_DEFAULT_PREFS,
    });

    // Verify it includes the customer notification data
    expect(result.emailsToNotify.size).toBe(2);
    expect(result.customerName).toBe("Stripe Customer Name");
  });
});

// ─── getUserActiveSubscriptions ─────────────────────────────

describe("getUserActiveSubscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty array when user has no customerId", async () => {
    mockUserFindUnique.mockResolvedValue({ customerId: null });

    const result = await getUserActiveSubscriptions("user_123");

    expect(result).toEqual([]);
    // Should not call Stripe when there's no customer
    expect(mockSubscriptionsList).not.toHaveBeenCalled();
  });

  it("should filter to only active and trialing subscriptions", async () => {
    mockUserFindUnique.mockResolvedValue({ customerId: "cus_456" });

    const activeSub = {
      id: "sub_active",
      status: "active",
      items: { data: [] },
    };
    const trialingSub = {
      id: "sub_trialing",
      status: "trialing",
      items: { data: [] },
    };
    const canceledSub = {
      id: "sub_canceled",
      status: "canceled",
      items: { data: [] },
    };
    const pastDueSub = {
      id: "sub_past_due",
      status: "past_due",
      items: { data: [] },
    };

    mockSubscriptionsList.mockResolvedValue({
      data: [activeSub, trialingSub, canceledSub, pastDueSub],
    });

    // subscriptions.retrieve is called for each sub to expand products
    mockSubscriptionsRetrieve
      .mockResolvedValueOnce(activeSub)
      .mockResolvedValueOnce(trialingSub)
      .mockResolvedValueOnce(canceledSub)
      .mockResolvedValueOnce(pastDueSub);

    const result = await getUserActiveSubscriptions("user_123");

    expect(result).toHaveLength(2);
    expect(result.map((s) => s.id)).toEqual(["sub_active", "sub_trialing"]);
  });
});

// ─── getOwnerSubscriptionInfo ───────────────────────────────

describe("getOwnerSubscriptionInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return hasActiveSubscription false when user has no customerId", async () => {
    mockUserFindUnique.mockResolvedValue({
      customerId: null,
      tierId: "free",
    });

    const result = await getOwnerSubscriptionInfo("owner_1", "org_1");

    expect(result).toEqual({
      hasActiveSubscription: false,
      subscriptions: [],
      tierId: "free",
    });
  });

  it("should classify tier subscriptions correctly", async () => {
    mockUserFindUnique.mockResolvedValue({
      customerId: "cus_owner",
      tierId: "tier_2",
    });

    const tierSub = {
      id: "sub_tier",
      status: "active",
      metadata: {},
      items: {
        data: [
          {
            price: {
              product: {
                name: "Team Plan",
                metadata: { shelf_tier: "tier_2" },
              },
            },
          },
        ],
      },
    };

    mockSubscriptionsList.mockResolvedValue({ data: [tierSub] });
    mockSubscriptionsRetrieve.mockResolvedValue(tierSub);

    const result = await getOwnerSubscriptionInfo("owner_1", "org_1");

    expect(result.hasActiveSubscription).toBe(true);
    expect(result.subscriptions).toEqual([
      {
        subscriptionId: "sub_tier",
        subscriptionName: "Team Plan",
        type: "tier",
      },
    ]);
  });

  it("should classify addon subscriptions and filter by matching organizationId", async () => {
    mockUserFindUnique.mockResolvedValue({
      customerId: "cus_owner",
      tierId: "tier_2",
    });

    const addonSub = {
      id: "sub_addon",
      status: "active",
      metadata: { organizationId: "org_1" },
      items: {
        data: [
          {
            price: {
              product: {
                name: "Audit Add-on",
                metadata: { product_type: "addon", addon_type: "audits" },
              },
            },
          },
        ],
      },
    };

    mockSubscriptionsList.mockResolvedValue({ data: [addonSub] });
    mockSubscriptionsRetrieve.mockResolvedValue(addonSub);

    const result = await getOwnerSubscriptionInfo("owner_1", "org_1");

    expect(result.hasActiveSubscription).toBe(true);
    expect(result.subscriptions).toEqual([
      {
        subscriptionId: "sub_addon",
        subscriptionName: "Audit Add-on",
        type: "addon",
      },
    ]);
  });

  it("should exclude addon subscriptions for different organizations", async () => {
    mockUserFindUnique.mockResolvedValue({
      customerId: "cus_owner",
      tierId: "tier_2",
    });

    const addonForOtherOrg = {
      id: "sub_addon_other",
      status: "active",
      metadata: { organizationId: "org_other" },
      items: {
        data: [
          {
            price: {
              product: {
                name: "Audit Add-on",
                metadata: { product_type: "addon", addon_type: "audits" },
              },
            },
          },
        ],
      },
    };

    mockSubscriptionsList.mockResolvedValue({ data: [addonForOtherOrg] });
    mockSubscriptionsRetrieve.mockResolvedValue(addonForOtherOrg);

    const result = await getOwnerSubscriptionInfo("owner_1", "org_1");

    expect(result.hasActiveSubscription).toBe(false);
    expect(result.subscriptions).toEqual([]);
  });
});

describe("customerHasOtherActiveAddonSubscription", () => {
  const teamItem = {
    price: { product: { id: "prod_team", metadata: { shelf_tier: "tier_2" } } },
  };
  const barcodesItem = {
    price: {
      product: {
        id: "prod_barcodes",
        metadata: { product_type: "addon", addon_type: "barcodes" },
      },
    },
  };
  const auditsItem = {
    price: {
      product: {
        id: "prod_audits",
        metadata: { product_type: "addon", addon_type: "audits" },
      },
    },
  };

  /** Serves the given subscriptions through the list-then-retrieve calls. */
  function customerHas(subscriptions: Array<Record<string, unknown>>) {
    mockSubscriptionsList.mockResolvedValue({
      data: subscriptions.map(({ id }) => ({ id })),
    });
    mockSubscriptionsRetrieve.mockImplementation((id: string) =>
      Promise.resolve(subscriptions.find((sub) => sub.id === id))
    );
  }

  const args = {
    customerId: "cus_1",
    organizationId: "org_1",
    addonType: "barcodes" as const,
    exceptSubscriptionId: "sub_tier",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds the add-on on another live subscription linked to the same workspace", async () => {
    customerHas([
      {
        id: "sub_tier",
        status: "paused",
        metadata: { organizationId: "org_1" },
        items: { data: [teamItem, barcodesItem] },
      },
      {
        id: "sub_addon",
        status: "active",
        metadata: { organizationId: "org_1" },
        items: { data: [barcodesItem] },
      },
    ]);

    await expect(customerHasOtherActiveAddonSubscription(args)).resolves.toBe(
      true
    );
    expect(mockSubscriptionsList).toHaveBeenCalledWith({
      customer: "cus_1",
      limit: 100,
    });
  });

  it("finds a covering subscription on a later page of the list", async () => {
    const pageOne = Array.from({ length: 10 }, (_, index) => ({
      id: `sub_${index}`,
      status: "active",
      metadata: { organizationId: "org_1" },
      items: { data: [teamItem] },
    }));
    const covering = {
      id: "sub_addon",
      status: "active",
      metadata: { organizationId: "org_1" },
      items: { data: [barcodesItem] },
    };
    mockSubscriptionsList
      .mockResolvedValueOnce({
        data: pageOne.map(({ id }) => ({ id })),
        has_more: true,
      })
      .mockResolvedValueOnce({ data: [{ id: covering.id }], has_more: false });
    const all = [...pageOne, covering];
    mockSubscriptionsRetrieve.mockImplementation((id: string) =>
      Promise.resolve(all.find((sub) => sub.id === id))
    );

    await expect(customerHasOtherActiveAddonSubscription(args)).resolves.toBe(
      true
    );
    expect(mockSubscriptionsList).toHaveBeenNthCalledWith(2, {
      customer: "cus_1",
      limit: 100,
      starting_after: "sub_9",
    });
  });

  it("ignores the subscription that raised the event", async () => {
    customerHas([
      {
        id: "sub_tier",
        status: "active",
        metadata: { organizationId: "org_1" },
        items: { data: [teamItem, barcodesItem] },
      },
    ]);

    await expect(customerHasOtherActiveAddonSubscription(args)).resolves.toBe(
      false
    );
  });

  it("ignores other workspaces, other add-ons and subscriptions that are not live", async () => {
    customerHas([
      {
        id: "sub_other_workspace",
        status: "active",
        metadata: { organizationId: "org_2" },
        items: { data: [barcodesItem] },
      },
      {
        id: "sub_audits",
        status: "active",
        metadata: { organizationId: "org_1" },
        items: { data: [auditsItem] },
      },
      {
        id: "sub_lapsed",
        status: "past_due",
        metadata: { organizationId: "org_1" },
        items: { data: [barcodesItem] },
      },
    ]);

    await expect(customerHasOtherActiveAddonSubscription(args)).resolves.toBe(
      false
    );
  });
});

describe("findWorkspaceOfPreviousTierSubscription", () => {
  const PRODUCTS: Record<string, { metadata: Record<string, string> }> = {
    prod_team: { metadata: { shelf_tier: "tier_2" } },
    prod_audits: { metadata: { product_type: "addon", addon_type: "audits" } },
  };

  /** A subscription as the list endpoint returns it: products unexpanded. */
  function listedSubscription({
    id,
    created,
    productIds,
    organizationId,
  }: {
    id: string;
    created: number;
    productIds: string[];
    organizationId?: string;
  }) {
    return {
      id,
      created,
      status: "paused",
      metadata: organizationId ? { organizationId } : {},
      items: {
        data: productIds.map((product) => ({ price: { product } })),
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsRetrieve.mockImplementation((productId: string) =>
      Promise.resolve(PRODUCTS[productId])
    );
    mockOrganizationFindMany.mockImplementation(
      ({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          where.id.in
            .filter((id) => id !== "org-transferred")
            .map((id) => ({ id }))
        )
    );
  });

  it("returns the workspace of the newest tier subscription the user still owns", async () => {
    mockSubscriptionsList.mockResolvedValue({
      has_more: false,
      data: [
        listedSubscription({
          id: "sub_old",
          created: 100,
          productIds: ["prod_team"],
          organizationId: "org-old",
        }),
        listedSubscription({
          id: "sub_paused",
          created: 200,
          productIds: ["prod_team", "prod_audits"],
          organizationId: "org-1",
        }),
        listedSubscription({
          id: "sub_unlinked",
          created: 300,
          productIds: ["prod_team"],
        }),
      ],
    });

    await expect(
      findWorkspaceOfPreviousTierSubscription({
        customerId: "cus_1",
        userId: "user-1",
      })
    ).resolves.toBe("org-1");

    expect(mockSubscriptionsList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_1", status: "all" })
    );
    expect(mockOrganizationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "user-1", type: "TEAM" }),
      })
    );
  });

  it("skips standalone add-on subscriptions and workspaces the user no longer owns", async () => {
    mockSubscriptionsList.mockResolvedValue({
      has_more: false,
      data: [
        listedSubscription({
          id: "sub_addon",
          created: 300,
          productIds: ["prod_audits"],
          organizationId: "org-addon",
        }),
        listedSubscription({
          id: "sub_transferred",
          created: 200,
          productIds: ["prod_team"],
          organizationId: "org-transferred",
        }),
      ],
    });

    await expect(
      findWorkspaceOfPreviousTierSubscription({
        customerId: "cus_1",
        userId: "user-1",
      })
    ).resolves.toBeNull();
  });

  it("returns null without a database lookup when no subscription is linked", async () => {
    mockSubscriptionsList.mockResolvedValue({
      has_more: false,
      data: [
        listedSubscription({
          id: "sub_1",
          created: 1,
          productIds: ["prod_team"],
        }),
      ],
    });

    await expect(
      findWorkspaceOfPreviousTierSubscription({
        customerId: "cus_1",
        userId: "user-1",
      })
    ).resolves.toBeNull();
    expect(mockOrganizationFindMany).not.toHaveBeenCalled();
  });
});

describe("createStripeCheckoutSession", () => {
  const baseArgs = {
    priceId: "price_team",
    userId: "user-1",
    domainUrl: "https://app.shelf.nu",
    customerId: "cus_1",
    intent: "subscribe" as const,
    auditPriceId: "price_audits",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckoutSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/c/1",
    });
    mockProductsRetrieve.mockResolvedValue({
      metadata: { shelf_tier: "tier_2" },
    });
    mockOrganizationFindMany.mockResolvedValue([{ id: "org-1" }]);
    mockSubscriptionsList.mockResolvedValue({
      has_more: false,
      data: [
        {
          id: "sub_paused",
          created: 1,
          status: "paused",
          metadata: { organizationId: "org-1" },
          items: { data: [{ price: { product: "prod_team" } }] },
        },
      ],
    });
  });

  it("links a returning Team subscription to the workspace of the previous one", async () => {
    await createStripeCheckoutSession({ ...baseArgs, shelfTier: "tier_2" });

    const params = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(params.subscription_data).toEqual({
      metadata: { organizationId: "org-1" },
    });
  });

  it("sends no subscription data for a first subscription", async () => {
    mockSubscriptionsList.mockResolvedValue({ has_more: false, data: [] });

    await createStripeCheckoutSession({ ...baseArgs, shelfTier: "tier_2" });

    const params = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty("subscription_data");
  });

  it("does not look for a workspace for a Plus subscription", async () => {
    await createStripeCheckoutSession({ ...baseArgs, shelfTier: "tier_1" });

    expect(mockSubscriptionsList).not.toHaveBeenCalled();
    const params = mockCheckoutSessionsCreate.mock.calls[0][0];
    expect(params).not.toHaveProperty("subscription_data");
  });
});

describe("validateSubscriptionIsActive", () => {
  const teamUser = {
    id: "user-1",
    skipSubscriptionCheck: false,
    tierId: "tier_2" as const,
  };

  function customerWith(...statuses: Stripe.Subscription.Status[]) {
    return {
      subscriptions: { data: statuses.map((status) => ({ status })) },
    } as unknown as CustomerWithSubscriptions;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["active", "trialing", "past_due"] as const)(
    "keeps the tier while a subscription is %s",
    async (status) => {
      await validateSubscriptionIsActive({
        user: teamUser,
        customer: customerWith(status),
      });

      expect(mockUserUpdate).not.toHaveBeenCalled();
    }
  );

  it.each(["unpaid", "paused", "incomplete_expired"] as const)(
    "downgrades to Free once the only subscription is %s",
    async (status) => {
      await validateSubscriptionIsActive({
        user: teamUser,
        customer: customerWith(status),
      });

      expect(mockUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: { tierId: "free" },
        })
      );
    }
  );

  it("leaves a user exempt from the check alone", async () => {
    await validateSubscriptionIsActive({
      user: { ...teamUser, skipSubscriptionCheck: true },
      customer: customerWith(),
    });

    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});
