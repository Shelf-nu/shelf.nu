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
  auditTrialWelcomeEmailText,
  sendAuditTrialWelcomeEmail,
} from "./audit-trial-welcome";

describe("auditTrialWelcomeEmailText", () => {
  it("includes firstName in greeting when provided", () => {
    const text = auditTrialWelcomeEmailText({
      firstName: "Alice",
      hasPaymentMethod: false,
    });
    expect(text).toMatch(/^Hey Alice,/);
  });

  it("uses generic greeting when firstName is null", () => {
    const text = auditTrialWelcomeEmailText({
      firstName: null,
      hasPaymentMethod: false,
    });
    expect(text).toMatch(/^Hey,/);
  });

  it("includes payment method warning when hasPaymentMethod is true", () => {
    const text = auditTrialWelcomeEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
    });
    expect(text).toContain("your subscription will automatically continue");
  });

  it("omits payment method warning when hasPaymentMethod is false", () => {
    const text = auditTrialWelcomeEmailText({
      firstName: "Alice",
      hasPaymentMethod: false,
    });
    expect(text).not.toContain("your subscription will automatically continue");
  });
});

describe("sendAuditTrialWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendEmail with correct to, subject, and content", async () => {
    await sendAuditTrialWelcomeEmail({
      firstName: "Alice",
      email: "alice@example.com",
      hasPaymentMethod: false,
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Your 7-day Audits trial is now active!",
      })
    );
    const call = mockSendEmail.mock.calls[0][0];
    expect(call.html).toBeDefined();
    expect(call.text).toBeDefined();
  });

  it("does not throw when sendEmail fails (logs error instead)", async () => {
    mockSendEmail.mockImplementation(() => {
      throw new Error("Network error");
    });

    await expect(
      sendAuditTrialWelcomeEmail({
        firstName: "Alice",
        email: "alice@example.com",
        hasPaymentMethod: false,
      })
    ).resolves.toBeUndefined();
  });
});
