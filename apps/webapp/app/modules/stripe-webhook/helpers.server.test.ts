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

vi.mock("~/utils/env", () => ({
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
}));

// why: Stripe SDK makes external API calls; we need a controllable
// constructEventAsync and the real StripeSignatureVerificationError class
const { mockConstructEventAsync } = vi.hoisted(() => ({
  mockConstructEventAsync: vi.fn(),
}));

vi.mock("~/utils/stripe.server", () => ({
  stripe: {
    webhooks: {
      constructEventAsync: mockConstructEventAsync,
    },
  },
}));

// why: Database module connects to Prisma during import
const { mockFindFirstOrThrow } = vi.hoisted(() => ({
  mockFindFirstOrThrow: vi.fn(),
}));

vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      findFirstOrThrow: mockFindFirstOrThrow,
    },
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
  default: {
    errors: {
      StripeSignatureVerificationError: FakeStripeSignatureVerificationError,
    },
  },
}));

import {
  isAddonSubscription,
  isHigherTier,
  isHigherOrEqualTier,
  sendAdminInvoiceEmail,
  constructVerifiedWebhookEvent,
  PaymentMethodWithoutCustomerResponse,
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
