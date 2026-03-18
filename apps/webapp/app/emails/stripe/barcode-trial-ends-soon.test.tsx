import { describe, it, expect, vi, beforeEach } from "vitest";

// why: sendEmail makes external network calls
const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
}));
vi.mock("~/emails/mail.server", () => ({
  sendEmail: mockSendEmail,
}));

// why: Logger makes external calls
const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));
vi.mock("~/utils/logger", () => ({
  Logger: { error: mockLoggerError },
}));

// why: env vars are read at import time; shelf.config.ts also imports from this module
vi.mock("~/utils/env", () => ({
  SERVER_URL: "https://app.shelf.nu",
  SUPPORT_EMAIL: "support@shelf.nu",
  SEND_ONBOARDING_EMAIL: false,
  ENABLE_PREMIUM_FEATURES: false,
  FREE_TRIAL_DAYS: "7",
  DISABLE_SIGNUP: false,
  DISABLE_SSO: false,
  SHOW_HOW_DID_YOU_FIND_US: false,
  COLLECT_BUSINESS_INTEL: false,
  GEOCODING_USER_AGENT: "",
}));

import {
  barcodeTrialEndsSoonEmailText,
  sendBarcodeTrialEndsSoonEmail,
} from "./barcode-trial-ends-soon";

describe("barcodeTrialEndsSoonEmailText", () => {
  const trialEndDate = new Date("2026-03-24T00:00:00Z");

  it("shows auto-continue message when hasPaymentMethod is true", () => {
    const text = barcodeTrialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
      trialEndDate,
    });
    expect(text).toContain("automatically continue");
    expect(text).toContain("charged at the regular rate");
  });

  it("shows paused/add-payment message when hasPaymentMethod is false", () => {
    const text = barcodeTrialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: false,
      trialEndDate,
    });
    expect(text).toContain("paused");
    expect(text).toContain("add a payment method");
  });

  it("formats trialEndDate correctly", () => {
    const text = barcodeTrialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
      trialEndDate,
    });
    expect(text).toContain("March 24, 2026");
  });

  it("includes firstName in greeting when provided", () => {
    const text = barcodeTrialEndsSoonEmailText({
      firstName: "Bob",
      hasPaymentMethod: true,
      trialEndDate,
    });
    expect(text).toMatch(/^Hey Bob,/);
  });
});

describe("sendBarcodeTrialEndsSoonEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendEmail with correct params", async () => {
    await sendBarcodeTrialEndsSoonEmail({
      firstName: "Alice",
      email: "alice@example.com",
      hasPaymentMethod: true,
      trialEndDate: new Date("2026-03-24T00:00:00Z"),
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Your Barcodes trial is ending soon",
      })
    );
  });

  it("does not throw when sendEmail fails", async () => {
    mockSendEmail.mockImplementation(() => {
      throw new Error("Network error");
    });

    await expect(
      sendBarcodeTrialEndsSoonEmail({
        firstName: "Alice",
        email: "alice@example.com",
        hasPaymentMethod: true,
        trialEndDate: new Date("2026-03-24T00:00:00Z"),
      })
    ).resolves.toBeUndefined();
  });
});
