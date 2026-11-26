import { describe, it, expect, vi } from "vitest";

// why: sendEmail makes external network calls
vi.mock("~/emails/mail.server", () => ({ sendEmail: vi.fn() }));

// why: Logger makes external calls
vi.mock("~/utils/logger", () => ({ Logger: { error: vi.fn() } }));

// why: env vars are read at import time; shelf.config.ts also imports from this module
vi.mock("~/utils/env", () => ({
  SERVER_URL: "https://app.shelf.nu",
  SUPPORT_EMAIL: "support@shelf.nu",
  SEND_ONBOARDING_EMAIL: false,
  ENABLE_PREMIUM_FEATURES: false,
  FREE_TRIAL_DAYS: "7",
  DISABLE_SIGNUP: false,
  DISABLE_SSO: false,
  ENABLE_SCIM: false,
  SHOW_HOW_DID_YOU_FIND_US: false,
  COLLECT_BUSINESS_INTEL: false,
  GEOCODING_USER_AGENT: "",
}));

import {
  subscriptionGrantedHtml,
  subscriptionGrantedText,
} from "./subscription-granted";

const NEW_WORKSPACE_URL = "https://app.shelf.nu/account-details/workspace/new";

describe("subscriptionGrantedText", () => {
  it("sends a customer without a Team workspace to create one", () => {
    const text = subscriptionGrantedText({
      customerName: "Alice",
      subscriptionName: "Team",
      needsTeamWorkspace: true,
    });

    expect(text).toContain(`Create your team workspace: ${NEW_WORKSPACE_URL}`);
    expect(text).not.toContain("Get started:");
  });

  it("opens the app for everyone else", () => {
    const text = subscriptionGrantedText({
      customerName: "Alice",
      subscriptionName: "Team",
    });

    expect(text).toContain("Get started: https://app.shelf.nu\n");
    expect(text).not.toContain(NEW_WORKSPACE_URL);
  });
});

describe("subscriptionGrantedText, Checkout add-ons", () => {
  it("carries Checkout add-ons on the workspace creation link", () => {
    const text = subscriptionGrantedText({
      subscriptionName: "Team",
      needsTeamWorkspace: true,
      newWorkspaceAddons: { audits: true, barcodes: true },
    });

    expect(text).toContain(
      `${NEW_WORKSPACE_URL}?includesAudits=true&includesBarcodes=true`
    );
  });
});

describe("subscriptionGrantedHtml", () => {
  it("points the button at workspace creation for a customer without a Team workspace", async () => {
    const html = await subscriptionGrantedHtml({
      subscriptionName: "Team",
      needsTeamWorkspace: true,
    });

    expect(html).toContain(`href="${NEW_WORKSPACE_URL}"`);
    expect(html).toContain("Create your team workspace");
  });

  it("keeps the button on the app otherwise", async () => {
    const html = await subscriptionGrantedHtml({ subscriptionName: "Team" });

    expect(html).toContain("Go to your workspace");
    expect(html).not.toContain(NEW_WORKSPACE_URL);
  });
});
