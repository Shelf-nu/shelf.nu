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
  trialEndsSoonEmailText,
  sendTrialEndsSoonEmail,
} from "./trial-ends-soon";

describe("trialEndsSoonEmailText", () => {
  const trialEndDate = new Date("2026-03-24T00:00:00Z");

  it("shows auto-charge warning when hasPaymentMethod is true", () => {
    const text = trialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
      planName: "Team",
      trialEndDate,
    });
    expect(text).toContain("ACTION REQUIRED");
    expect(text).toContain(
      "automatically charged at the regular subscription rate"
    );
    expect(text).toContain("Shelf Team");
  });

  it("shows upgrade message when hasPaymentMethod is false", () => {
    const text = trialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: false,
      planName: "Team",
      trialEndDate,
    });
    expect(text).not.toContain("ACTION REQUIRED");
    expect(text).toContain("Shelf Team trial");
    expect(text).toContain("upgrade to a paid plan");
  });

  it("includes planName in the text", () => {
    const text = trialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: false,
      planName: "Plus",
      trialEndDate,
    });
    expect(text).toContain("Shelf Plus trial");
  });

  it("formats trialEndDate correctly", () => {
    const text = trialEndsSoonEmailText({
      firstName: "Alice",
      hasPaymentMethod: true,
      planName: "Team",
      trialEndDate,
    });
    expect(text).toContain("March 24, 2026");
  });

  it("includes firstName in greeting when provided", () => {
    const text = trialEndsSoonEmailText({
      firstName: "Bob",
      hasPaymentMethod: false,
      planName: "Team",
      trialEndDate,
    });
    expect(text).toMatch(/^Hey Bob,/);
  });
});

describe("sendTrialEndsSoonEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls sendEmail with auto-charge subject when hasPaymentMethod is true", async () => {
    await sendTrialEndsSoonEmail({
      firstName: "Alice",
      email: "alice@example.com",
      hasPaymentMethod: true,
      planName: "Team",
      trialEndDate: new Date("2026-03-24T00:00:00Z"),
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "alice@example.com",
        subject: "Your Shelf Team trial ends in 3 days — auto-charge reminder",
      })
    );
  });

  it("calls sendEmail with generic subject when hasPaymentMethod is false", async () => {
    await sendTrialEndsSoonEmail({
      firstName: "Alice",
      email: "alice@example.com",
      hasPaymentMethod: false,
      planName: "Plus",
      trialEndDate: new Date("2026-03-24T00:00:00Z"),
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Shelf Plus trial is ending soon",
      })
    );
  });

  it("does not throw when sendEmail fails", async () => {
    mockSendEmail.mockImplementation(() => {
      throw new Error("Network error");
    });

    await expect(
      sendTrialEndsSoonEmail({
        firstName: "Alice",
        email: "alice@example.com",
        hasPaymentMethod: true,
        planName: "Team",
        trialEndDate: new Date("2026-03-24T00:00:00Z"),
      })
    ).resolves.toBeUndefined();
  });
});
