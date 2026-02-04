import type Stripe from "stripe";
import { describe, it, expect, vi, beforeEach } from "vitest";

// why: Stripe SDK makes external API calls that should not run in tests
// Using vi.hoisted to ensure the mock function is available when vi.mock runs
const { mockCustomersRetrieve } = vi.hoisted(() => ({
  mockCustomersRetrieve: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn().mockImplementation(() => ({
    customers: {
      retrieve: mockCustomersRetrieve,
    },
  })),
}));

// why: Database module tries to connect to Prisma during import
vi.mock("~/database/db.server", () => ({
  db: {
    user: {
      update: vi.fn(),
    },
  },
}));

// Import after mocking
import {
  getCustomerNotificationData,
  getInvoiceNotificationData,
} from "./stripe.server";

describe("getCustomerNotificationData", () => {
  const baseUser = {
    email: "user@example.com",
    firstName: "John",
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
      user: { email: "user@example.com", firstName: null },
    });

    expect(result.customerName).toBeNull();
  });
});

describe("getInvoiceNotificationData", () => {
  const baseUser = {
    email: "user@example.com",
    firstName: "John",
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
    });

    // Verify it includes the customer notification data
    expect(result.emailsToNotify.size).toBe(2);
    expect(result.customerName).toBe("Stripe Customer Name");
  });
});
