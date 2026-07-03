/**
 * Tests for the feedback support email: plain-text/HTML rendering of the
 * auto-captured context and error-details sections, and the subject/type
 * labeling for reports started from an error page.
 *
 * @see {@link file://./feedback-email.tsx}
 */
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
  feedbackEmailText,
  feedbackEmailHtml,
  sendFeedbackEmail,
} from "./feedback-email";

const BASE_PROPS = {
  userName: "Alice Doe",
  userEmail: "alice@example.com",
  organizationName: "Acme",
  type: "issue" as const,
  message: "The asset list shows the wrong creation time",
};

const CONTEXT_PROPS = {
  ...BASE_PROPS,
  userId: "user_123",
  organizationId: "org_456",
  currentUrl: "https://app.shelf.nu/assets",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  viewport: "1512x824 @2x",
  appVersion: "abc123",
};

const ERROR_CONTEXT = {
  traceId: "trace_789",
  sentryEventId: "evt_abc",
  errorStatus: "500",
  errorTitle: "Oops, something went wrong",
  errorMessage: "Something went wrong while fetching the kit",
};

describe("feedbackEmailText", () => {
  it("renders the base fields", () => {
    const text = feedbackEmailText(BASE_PROPS);
    expect(text).toContain("Type: Issue");
    expect(text).toContain("From: Alice Doe (alice@example.com)");
    expect(text).toContain("Organization: Acme");
    expect(text).toContain(BASE_PROPS.message);
  });

  it("labels ideas as Idea", () => {
    const text = feedbackEmailText({ ...BASE_PROPS, type: "idea" });
    expect(text).toContain("Type: Idea");
  });

  it("includes the auto-captured context rows when provided", () => {
    const text = feedbackEmailText(CONTEXT_PROPS);
    expect(text).toContain("Page: https://app.shelf.nu/assets");
    expect(text).toContain("App version: abc123");
    // The raw user agent is rendered in parsed, human-readable form
    expect(text).toContain("Browser: Chrome");
    expect(text).not.toContain("AppleWebKit");
    expect(text).toContain("Viewport: 1512x824 @2x");
    expect(text).toContain("Organization id: org_456");
    expect(text).toContain("User id: user_123");
  });

  it("falls back to the raw user agent when unparseable", () => {
    const text = feedbackEmailText({
      ...BASE_PROPS,
      userAgent: "curl/8.4.0",
    });
    expect(text).toContain("Browser: curl/8.4.0");
  });

  it("omits context rows that are not provided", () => {
    const text = feedbackEmailText(BASE_PROPS);
    expect(text).not.toContain("Page:");
    expect(text).not.toContain("Browser:");
    expect(text).not.toContain("Error details:");
  });

  it("renders the error details block and Error report label", () => {
    const text = feedbackEmailText({
      ...CONTEXT_PROPS,
      errorContext: ERROR_CONTEXT,
    });
    expect(text).toContain("Type: Error report");
    expect(text).toContain("Error details:");
    expect(text).toContain("Status: 500");
    expect(text).toContain("Title: Oops, something went wrong");
    expect(text).toContain(
      "Message: Something went wrong while fetching the kit"
    );
    expect(text).toContain("Trace id: trace_789");
    expect(text).toContain("Sentry event id: evt_abc");
  });

  it("includes the screenshot link when present", () => {
    const text = feedbackEmailText({
      ...BASE_PROPS,
      screenshotUrl: "https://cdn.example.com/shot.png",
    });
    expect(text).toContain("Screenshot: https://cdn.example.com/shot.png");
  });
});

describe("feedbackEmailHtml", () => {
  it("links the page URL and renders error details", async () => {
    const html = await feedbackEmailHtml({
      ...CONTEXT_PROPS,
      errorContext: ERROR_CONTEXT,
    });
    expect(html).toContain('href="https://app.shelf.nu/assets"');
    expect(html).toContain("Error report");
    expect(html).toContain("trace_789");
    expect(html).toContain("evt_abc");
  });

  it("renders without optional context", async () => {
    const html = await feedbackEmailHtml(BASE_PROPS);
    expect(html).toContain("Alice Doe");
    expect(html).not.toContain("Error details");
  });

  it("does not link page URLs that point outside the app", async () => {
    // A crafted submission must not plant a clickable phishing link in
    // the support inbox; off-origin URLs render as plain text
    const html = await feedbackEmailHtml({
      ...BASE_PROPS,
      currentUrl: "https://evil.example/sso-login",
    });
    expect(html).toContain("https://evil.example/sso-login");
    expect(html).not.toContain('href="https://evil.example/sso-login"');
  });
});

describe("sendFeedbackEmail", () => {
  beforeEach(() => {
    mockSendEmail.mockClear();
  });

  it("sends to support with reply-to set to the submitter", async () => {
    await sendFeedbackEmail(BASE_PROPS);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "support@shelf.nu",
        replyTo: "alice@example.com",
        subject: expect.stringContaining("New feedback [Issue]:"),
      })
    );
  });

  it("uses the Error report subject label when error context is present", async () => {
    await sendFeedbackEmail({ ...BASE_PROPS, errorContext: ERROR_CONTEXT });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining("New feedback [Error report]:"),
      })
    );
  });
});
