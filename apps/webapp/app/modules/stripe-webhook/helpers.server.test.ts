import type Stripe from "stripe";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShelfError } from "~/utils/error";

// why: env module reads process.env at import time; we need to control
// STRIPE_WEBHOOK_ENDPOINT_SECRET, ADMIN_EMAIL, and CUSTOM_INSTALL_CUSTOMERS
const {
  mockStripeWebhookEndpointSecret,
  mockAdminEmail,
  mockCustomInstallCustomers,
} = vi.hoisted(() => ({
  mockStripeWebhookEndpointSecret: {
    value: "whsec_test" as string | undefined,
  },
  mockAdminEmail: { value: "admin@test.com" as string | undefined },
  mockCustomInstallCustomers: { value: "" as string | undefined },
}));

vi.mock(import("~/utils/env"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    get STRIPE_WEBHOOK_ENDPOINT_SECRET() {
      return mockStripeWebhookEndpointSecret.value;
    },
    get ADMIN_EMAIL() {
      return mockAdminEmail.value;
    },
    get CUSTOM_INSTALL_CUSTOMERS() {
      return mockCustomInstallCustomers.value;
    },
    SERVER_URL: "https://app.shelf.nu",
  };
});

// why: Stripe SDK makes external API calls; we need a controllable
// constructEventAsync and the real StripeSignatureVerificationError class
const {
  mockConstructEventAsync,
  mockGetCustomerSubscriptions,
  mockSubscriptionsList,
} = vi.hoisted(() => ({
  mockConstructEventAsync: vi.fn(),
  mockGetCustomerSubscriptions: vi.fn(),
  mockSubscriptionsList: vi.fn(),
}));

vi.mock(import("~/utils/stripe.server"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    stripe: {
      webhooks: { constructEventAsync: mockConstructEventAsync },
      subscriptions: { list: mockSubscriptionsList },
    } as never,
    getCustomerSubscriptionsWithProducts: mockGetCustomerSubscriptions,
  };
});

// why: Database module connects to Prisma during import
const { mockFindFirstOrThrow, mockUserFindUnique, mockOrgFindMany } =
  vi.hoisted(() => ({
    mockFindFirstOrThrow: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockOrgFindMany: vi.fn(),
  }));

vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findFirstOrThrow: mockFindFirstOrThrow,
      findUnique: mockUserFindUnique,
    },
    organization: { findMany: mockOrgFindMany },
  },
}));

// why: sendEmail makes external network calls
const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
}));

vi.mock("~/emails/mail.server", () => ({
  sendEmail: mockSendEmail,
}));

// why: We need the StripeSignatureVerificationError class for instanceof
// checks in the catch block; must be hoisted so the vi.mock factory can use it
const { FakeStripeSignatureVerificationError } = vi.hoisted(() => {
  class FakeStripeSignatureVerificationError extends Error {
    constructor(message = "sig error") {
      super(message);
      this.name = "StripeSignatureVerificationError";
    }
  }
  return { FakeStripeSignatureVerificationError };
});

vi.mock("stripe", () => ({
  // A constructible `function`: the real `~/utils/stripe.server` module calls
  // `new Stripe(...)` when it loads.
  default: Object.assign(
    vi.fn().mockImplementation(function () {
      return {};
    }),
    {
      errors: {
        StripeSignatureVerificationError: FakeStripeSignatureVerificationError,
      },
    }
  ),
}));

import {
  findAddonsAwaitingWorkspace,
  highestPlanTier,
  isAddonSubscription,
  isHigherTier,
  isTierId,
  isHigherOrEqualTier,
  sendAdminInvoiceEmail,
  constructVerifiedWebhookEvent,
  PaymentMethodWithoutCustomerResponse,
  parseCustomInstallCustomers,
} from "./helpers.server";

describe("isAddonSubscription", () => {
  const baseEvent = { type: "customer.subscription.created" } as Stripe.Event;

  it("returns false when tierId is present", () => {
    expect(
      isAddonSubscription({
        tierId: "tier_1",
        productType: undefined,
        event: baseEvent,
      })
    ).toBe(false);
  });

  it("returns true when productType is 'addon' and no tierId", () => {
    expect(
      isAddonSubscription({
        tierId: undefined,
        productType: "addon",
        event: baseEvent,
      })
    ).toBe(true);
  });

  it("throws ShelfError when no tierId and not addon", () => {
    expect(() =>
      isAddonSubscription({
        tierId: undefined,
        productType: "something_else",
        event: baseEvent,
      })
    ).toThrow(ShelfError);
  });
});

describe("isTierId", () => {
  it("accepts every tier id", () => {
    for (const tier of ["free", "tier_1", "tier_2", "custom"]) {
      expect(isTierId(tier)).toBe(true);
    }
  });

  it("rejects keys inherited from Object.prototype and anything else", () => {
    for (const value of ["constructor", "toString", "tier_3", "", undefined]) {
      expect(isTierId(value)).toBe(false);
    }
  });
});

describe("highestPlanTier", () => {
  it("returns the highest plan, skipping add-ons, deleted and unexpanded products", () => {
    expect(
      highestPlanTier([
        "prod_unexpanded",
        null,
        { id: "p_del", deleted: true } as Stripe.DeletedProduct,
        {
          id: "p_addon",
          metadata: { product_type: "addon", shelf_tier: "custom" },
        } as unknown as Stripe.Product,
        {
          id: "p_plus",
          metadata: { shelf_tier: "tier_1" },
        } as unknown as Stripe.Product,
        {
          id: "p_bad",
          metadata: { shelf_tier: "constructor" },
        } as unknown as Stripe.Product,
      ])
    ).toBe("tier_1");
  });

  it("returns undefined when no product is a plan", () => {
    expect(highestPlanTier([])).toBeUndefined();
  });
});

describe("isHigherTier", () => {
  it("returns true when new tier is higher", () => {
    expect(isHigherTier("tier_2", "tier_1")).toBe(true);
  });

  it("returns false when tiers are equal", () => {
    expect(isHigherTier("tier_1", "tier_1")).toBe(false);
  });

  it("returns false when new tier is lower", () => {
    expect(isHigherTier("tier_1", "tier_2")).toBe(false);
  });
});

describe("isHigherOrEqualTier", () => {
  it("returns true when new tier is higher", () => {
    expect(isHigherOrEqualTier("tier_2", "tier_1")).toBe(true);
  });

  it("returns true when tiers are equal", () => {
    expect(isHigherOrEqualTier("tier_1", "tier_1")).toBe(true);
  });

  it("returns false when new tier is lower", () => {
    expect(isHigherOrEqualTier("tier_1", "tier_2")).toBe(false);
  });
});

describe("sendAdminInvoiceEmail", () => {
  const baseParams = {
    user: {
      id: "u1",
      email: "user@test.com",
      firstName: "Jane",
      lastName: "Doe",
      displayName: null,
    },
    eventType: "invoice.payment_failed",
    invoiceId: "inv_123",
    subject: "Invoice alert",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendEmail when ADMIN_EMAIL is set", () => {
    mockAdminEmail.value = "admin@test.com";
    sendAdminInvoiceEmail(baseParams);
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@test.com",
        subject: "Invoice alert",
      })
    );
  });

  it("does not call sendEmail when ADMIN_EMAIL is falsy", () => {
    mockAdminEmail.value = undefined;
    sendAdminInvoiceEmail(baseParams);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe("constructVerifiedWebhookEvent", () => {
  const baseUser = {
    id: "u1",
    email: "user@test.com",
    firstName: "Jane",
    lastName: "Doe",
    displayName: null,
    tierId: "tier_1",
    warnForNoPaymentMethod: false,
  };

  function makeRequest(
    body = "{}",
    headers: Record<string, string> = { "stripe-signature": "sig_test" }
  ) {
    return new Request("https://app.shelf.nu/api/stripe-webhook", {
      method: "POST",
      body,
      headers,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockStripeWebhookEndpointSecret.value = "whsec_test";
    mockCustomInstallCustomers.value = "";
  });

  it("throws ShelfError (status 400) when stripe-signature header is missing", async () => {
    const req = makeRequest("{}", {});
    try {
      await constructVerifiedWebhookEvent(req);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).status).toBe(400);
      expect((e as ShelfError).message).toMatch(/stripe-signature/i);
    }
  });

  it("throws ShelfError (status 500) when STRIPE_WEBHOOK_ENDPOINT_SECRET is not set", async () => {
    mockStripeWebhookEndpointSecret.value = undefined;
    const req = makeRequest();
    try {
      await constructVerifiedWebhookEvent(req);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).status).toBe(500);
      expect((e as ShelfError).message).toMatch(
        /STRIPE_WEBHOOK_ENDPOINT_SECRET/
      );
    }
  });

  it("throws ShelfError (status 500) when stripe client is null", async () => {
    // Temporarily override the stripe mock to return null
    const stripeMod = await import("~/utils/stripe.server");
    const originalStripe = stripeMod.stripe;
    (stripeMod as { stripe: unknown }).stripe = null;

    const req = makeRequest();
    try {
      await constructVerifiedWebhookEvent(req);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).status).toBe(500);
      expect((e as ShelfError).message).toMatch(/Stripe client/i);
    } finally {
      (stripeMod as { stripe: unknown }).stripe = originalStripe;
    }
  });

  it("throws ShelfError (status 400) on StripeSignatureVerificationError", async () => {
    mockConstructEventAsync.mockRejectedValue(
      new FakeStripeSignatureVerificationError("bad sig")
    );

    const req = makeRequest();
    try {
      await constructVerifiedWebhookEvent(req);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).status).toBe(400);
      expect((e as ShelfError).message).toMatch(/signature verification/i);
    }
  });

  it("throws ShelfError (status 500) on other constructEventAsync errors", async () => {
    mockConstructEventAsync.mockRejectedValue(new Error("network failure"));

    const req = makeRequest();
    try {
      await constructVerifiedWebhookEvent(req);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ShelfError);
      expect((e as ShelfError).status).toBe(500);
      expect((e as ShelfError).message).toMatch(/Failed to construct/i);
    }
  });

  it("throws PaymentMethodWithoutCustomerResponse for payment_method events without customer", async () => {
    mockConstructEventAsync.mockResolvedValue({
      type: "payment_method.attached",
      data: { object: { customer: null } },
    });

    const req = makeRequest();
    try {
      await constructVerifiedWebhookEvent(req);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PaymentMethodWithoutCustomerResponse);
    }
  });

  it("returns null user for custom install customers", async () => {
    mockCustomInstallCustomers.value = "cus_custom1,cus_custom2";
    mockConstructEventAsync.mockResolvedValue({
      type: "invoice.paid",
      data: { object: { customer: "cus_custom1" } },
    });
    mockFindFirstOrThrow.mockResolvedValue(baseUser);

    const req = makeRequest();
    const result = await constructVerifiedWebhookEvent(req);

    expect(result.event.type).toBe("invoice.paid");
    expect(result.customerId).toBe("cus_custom1");
    expect(result.user).toBeNull();
  });

  it("excludes a custom install customer listed after a space", async () => {
    // The env var is written by a human, and `cus_A, cus_B` is how a human
    // writes a list. Without trimming, the entry reads " cus_custom2", the
    // customer is NOT recognised as custom-install, and the webhook goes on
    // to downgrade them to free and pause their subscription.
    mockCustomInstallCustomers.value = "cus_custom1, cus_custom2";
    // why: the signed Stripe event is what the helper verifies and unwraps.
    // Stubbing it lets the test name the customer under test — the SECOND
    // entry, the one a missing trim would leave with a leading space.
    mockConstructEventAsync.mockResolvedValue({
      type: "invoice.paid",
      data: { object: { customer: "cus_custom2" } },
    });
    // why: the helper resolves the customer to a user BEFORE the exclusion
    // check, so a resolvable user is what lets the test reach that check. It
    // is also what a failure returns instead of null, which is the assertion.
    mockFindFirstOrThrow.mockResolvedValue(baseUser);

    const result = await constructVerifiedWebhookEvent(makeRequest());

    expect(result.user).toBeNull();
  });

  it("returns event and user for regular customers", async () => {
    mockConstructEventAsync.mockResolvedValue({
      type: "invoice.paid",
      data: { object: { customer: "cus_regular" } },
    });
    mockFindFirstOrThrow.mockResolvedValue(baseUser);

    const req = makeRequest();
    const result = await constructVerifiedWebhookEvent(req);

    expect(result.event.type).toBe("invoice.paid");
    expect(result.customerId).toBe("cus_regular");
    expect(result.user).toEqual(baseUser);
  });
});

describe("PaymentMethodWithoutCustomerResponse", () => {
  it("has correct _tag property", () => {
    const response = new PaymentMethodWithoutCustomerResponse();
    expect(response._tag).toBe("PaymentMethodWithoutCustomerResponse");
  });
});

describe("parseCustomInstallCustomers", () => {
  it("trims entries written with spaces after the commas", () => {
    expect(parseCustomInstallCustomers("cus_A, cus_B ,cus_C")).toEqual([
      "cus_A",
      "cus_B",
      "cus_C",
    ]);
  });

  it("preserves casing", () => {
    // Stripe customer ids are case-sensitive, so normalising them the way a
    // domain list is normalised would break every match.
    expect(parseCustomInstallCustomers("cus_AbC123")).toEqual(["cus_AbC123"]);
  });

  it("yields nothing for an unset or empty value", () => {
    // `"".split(",")` is `[""]`, which is an entry that matches nothing but
    // still reads as a populated list.
    expect(parseCustomInstallCustomers(undefined)).toEqual([]);
    expect(parseCustomInstallCustomers("")).toEqual([]);
    expect(parseCustomInstallCustomers("  ,  ")).toEqual([]);
  });
});

describe("findAddonsAwaitingWorkspace", () => {
  const TEAM = { id: "prod_team", metadata: { shelf_tier: "tier_2" } };
  const AUDITS = {
    id: "prod_audits",
    metadata: { product_type: "addon", addon_type: "audits" },
  };
  const BARCODES = {
    id: "prod_barcodes",
    metadata: { product_type: "addon", addon_type: "barcodes" },
  };

  /** A customer subscription as Stripe holds it, products expanded. */
  function subscription(
    products: { id: string; metadata: Record<string, string> }[],
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
      items: { data: products.map((product) => ({ price: { product } })) },
    };
  }

  /** Makes Stripe hold these subscriptions, for both the plain list and the expanded read. */
  function stripeHolds(...subscriptions: ReturnType<typeof subscription>[]) {
    mockSubscriptionsList.mockResolvedValue({
      data: subscriptions,
      has_more: false,
    });
    mockGetCustomerSubscriptions.mockResolvedValue(subscriptions);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ customerId: "cus_1" });
    // The new workspace is the only Team workspace the user owns unless a
    // test says otherwise.
    mockOrgFindMany.mockResolvedValue([{ id: "org-new", name: "ZZ New" }]);
  });

  it("links the add-ons of a subscription without a workspace to the user's first Team workspace", async () => {
    stripeHolds(subscription([TEAM, AUDITS, BARCODES]));

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: true, barcodes: true });
    expect(mockGetCustomerSubscriptions).toHaveBeenCalledWith("cus_1");
    expect(mockOrgFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", type: "TEAM" } })
    );
  });

  it("links them next to workspaces that already have their own plan subscription", async () => {
    stripeHolds(
      subscription([TEAM], {
        id: "sub_0",
        metadata: { organizationId: "org-old" },
      }),
      subscription([TEAM, BARCODES])
    );
    mockOrgFindMany.mockResolvedValue([
      { id: "org-old", name: "ZZ Old" },
      { id: "org-new", name: "ZZ New" },
    ]);

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: false, barcodes: true });
  });

  it("links nothing when another Team workspace of the user could also be meant", async () => {
    stripeHolds(subscription([TEAM, AUDITS]));
    mockOrgFindMany.mockResolvedValue([
      { id: "org-old", name: "ZZ Old" },
      { id: "org-new", name: "ZZ New" },
    ]);

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: false, barcodes: false });
  });

  it("ignores add-ons already linked to a workspace or on a subscription that is not live", async () => {
    stripeHolds(
      subscription([TEAM, AUDITS], {
        metadata: { organizationId: "org-old" },
      }),
      subscription([TEAM, BARCODES], { id: "sub_2", status: "canceled" })
    );

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: false, barcodes: false });
    expect(mockOrgFindMany).not.toHaveBeenCalled();
  });

  it("reads nothing from Stripe for a user without a customer", async () => {
    mockUserFindUnique.mockResolvedValue({ customerId: null });

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: false, barcodes: false });
    expect(mockGetCustomerSubscriptions).not.toHaveBeenCalled();
  });
});

describe("findAddonsAwaitingWorkspace, ambiguous and cheap cases", () => {
  const TEAM = { id: "prod_team", metadata: { shelf_tier: "tier_2" } };
  const AUDITS = {
    id: "prod_audits",
    metadata: { product_type: "addon", addon_type: "audits" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ customerId: "cus_1" });
    mockOrgFindMany.mockResolvedValue([{ id: "org-new", name: "ZZ New" }]);
  });

  it("links nothing while a second live plan subscription names no workspace", async () => {
    const subs = [
      {
        id: "sub_checkout",
        status: "active",
        metadata: {},
        items: { data: [{ price: { product: TEAM } }] },
      },
      {
        id: "sub_invoice",
        status: "active",
        metadata: {},
        items: {
          data: [{ price: { product: TEAM } }, { price: { product: AUDITS } }],
        },
      },
    ];
    mockSubscriptionsList.mockResolvedValue({ data: subs, has_more: false });
    mockGetCustomerSubscriptions.mockResolvedValue(subs);

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: false, barcodes: false });
  });

  it("makes one Stripe call when every live subscription already names a workspace", async () => {
    mockSubscriptionsList.mockResolvedValue({
      data: [
        {
          id: "sub_1",
          status: "active",
          metadata: { organizationId: "org-1" },
        },
      ],
      has_more: false,
    });

    await expect(
      findAddonsAwaitingWorkspace({
        userId: "user-1",
        organizationId: "org-new",
      })
    ).resolves.toEqual({ audits: false, barcodes: false });
    expect(mockGetCustomerSubscriptions).not.toHaveBeenCalled();
  });
});
