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
  barcodeTrialEndsTomorrowEmailText,
  sendBarcodeTrialEndsTomorrowEmail,
} from "./barcode-trial-ends-tomorrow";

describe("barcodeTrialEndsTomorrowEmailText", () => {
  const trialEndDate = new Date("2026-03-24T00:00:00Z");

  it("shows urgent auto-charge warning when hasPaymentMethod is true", () => {
    const text = barcodeTrialEndsTomorrowEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
      trialEndDate,
    });
    expect(text).toContain("ACTION REQUIRED");
    expect(text).toContain("charged tomorrow");
    expect(text).toContain(
      "automatically charged at the regular subscription rate"
    );
  });

  it("shows paused/add-payment message when hasPaymentMethod is false", () => {
    const text = barcodeTrialEndsTomorrowEmailText({
      firstName: "Alice",
      hasPaymentMethod: false,
      trialEndDate,
    });
    expect(text).toContain("paused");
    expect(text).toContain("add a payment method");
  });

  it("formats trialEndDate correctly", () => {
    const text = barcodeTrialEndsTomorrowEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
      trialEndDate,
    });
    expect(text).toContain("March 24, 2026");
  });

  it("includes firstName in greeting when provided", () => {
    const text = barcodeTrialEndsTomorrowEmailText({
      firstName: "Bob",
      hasPaymentMethod: true,
      trialEndDate,
    });
    expect(text).toMatch(/^Hey Bob,/);
  });
});

describe("sendBarcodeTrialEndsTomorrowEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendEmail with auto-charge subject when hasPaymentMethod is true", async () => {
    await sendBarcodeTrialEndsTomorrowEmail({
      firstName: "Alice",
      email: "alice@example.com",
      hasPaymentMethod: true,
      trialEndDate: new Date("2026-03-24T00:00:00Z"),
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Your Barcodes trial ends tomorrow — auto-charge reminder",
      })
    );
  });

  it("calls sendEmail with generic subject when hasPaymentMethod is false", async () => {
    await sendBarcodeTrialEndsTomorrowEmail({
      firstName: "Alice",
      email: "alice@example.com",
      hasPaymentMethod: false,
      trialEndDate: new Date("2026-03-24T00:00:00Z"),
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Barcodes trial ends tomorrow",
      })
    );
  });

  it("does not throw when sendEmail fails", async () => {
    mockSendEmail.mockImplementation(() => {
      throw new Error("Network error");
    });

    await expect(
      sendBarcodeTrialEndsTomorrowEmail({
        firstName: "Alice",
        email: "alice@example.com",
        hasPaymentMethod: true,
        trialEndDate: new Date("2026-03-24T00:00:00Z"),
      })
    ).resolves.toBeUndefined();
  });
});
