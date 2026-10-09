/**
 * Tests for the copy of in-app feedback that goes back to its submitter:
 * who it is sent to, where replies go, what it shows, and that none of the
 * auto-captured context from the internal support email reaches it.
 *
 * The email travels the real `sendEmail` -> `triggerEmail` path, so the
 * assertions read the message handed to the SMTP transport, after the
 * soft-deleted-user guard has run.
 *
 * @see {@link file://./feedback-copy-email.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// why: SMTP is an external network call; the tests read what it was handed
const { mockSendMail } = vi.hoisted(() => ({
  mockSendMail: vi.fn().mockResolvedValue({}),
}));
vi.mock("~/emails/transporter.server", () => ({
  transporter: { sendMail: mockSendMail },
}));

// why: the retry queue is pg-boss on Postgres; only used when a send fails
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { emailQueue: "email" },
  scheduler: { send: vi.fn(), work: vi.fn() },
}));

// why: Logger reports to Sentry
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

/* A self-hosted instance's own addresses, so any shelf.nu address in the
 * output can only have come from a hard-coded value */
const INSTANCE = vi.hoisted(() => ({
  supportEmail: "help@assets.example.org" as string | undefined,
}));

// why: env vars are read at import time; shelf.config.ts also imports from this module
vi.mock("~/utils/env", () => ({
  get SUPPORT_EMAIL() {
    return INSTANCE.supportEmail;
  },
  SERVER_URL: "https://assets.example.org",
  SMTP_FROM: '"Assets" <noreply@assets.example.org>',
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
  feedbackCopyEmailHtml,
  feedbackCopyEmailText,
  sendFeedbackCopyEmail,
} from "./feedback-copy-email";

const SUBMISSION = {
  firstName: "Jane",
  userEmail: "jane@example.com",
  type: "issue" as const,
  message: "The asset list shows the wrong creation time",
  screenshotUrl: "https://storage.example.org/feedback/user_123/shot.png",
};

/**
 * Everything the internal support email carries beyond what the submitter
 * wrote. Distinctive values, so a match can only mean that field leaked.
 */
const INTERNAL_FIELDS = {
  userName: "Jane Doe",
  userId: "user_internal_123",
  organizationName: "Org Name Internal",
  organizationId: "org_internal_456",
  currentUrl: "https://assets.example.org/assets?internal-page=1",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  viewport: "1512x824 @2x",
  appVersion: "app_version_abc123",
  errorContext: {
    traceId: "trace_internal_789",
    sentryEventId: "sentry_internal_evt",
    errorStatus: "599",
    errorTitle: "Internal error title",
    errorMessage: "Internal error message from the error page",
  },
};

const INTERNAL_VALUES = [
  INTERNAL_FIELDS.userName,
  INTERNAL_FIELDS.userId,
  INTERNAL_FIELDS.organizationName,
  INTERNAL_FIELDS.organizationId,
  INTERNAL_FIELDS.currentUrl,
  INTERNAL_FIELDS.userAgent,
  "Chrome 126",
  INTERNAL_FIELDS.viewport,
  INTERNAL_FIELDS.appVersion,
  ...Object.values(INTERNAL_FIELDS.errorContext),
];

/** The one message handed to the SMTP transport */
function sentMessage() {
  expect(mockSendMail).toHaveBeenCalledOnce();
  return mockSendMail.mock.calls[0][0] as {
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  };
}

beforeEach(() => {
  mockSendMail.mockClear();
  INSTANCE.supportEmail = "help@assets.example.org";
});

describe("sendFeedbackCopyEmail", () => {
  it("sends the copy to the submitter, with replies going to the support inbox", async () => {
    await sendFeedbackCopyEmail(SUBMISSION);

    const message = sentMessage();
    expect(message.to).toBe("jane@example.com");
    expect(message.replyTo).toBe("help@assets.example.org");
    expect(message.subject).toBe(
      "Thanks for your feedback: The asset list shows the wrong creation time"
    );
  });

  it("shows the type, the message and the screenshot link", async () => {
    await sendFeedbackCopyEmail(SUBMISSION);

    const { text, html } = sentMessage();
    expect(text).toContain("Type: Issue");
    expect(text).toContain(SUBMISSION.message);
    expect(text).toContain(`Screenshot: ${SUBMISSION.screenshotUrl}`);
    expect(text).toContain("If you want to add anything, reply to this email.");
    expect(html).toContain(SUBMISSION.message);
    expect(html).toContain(`href="${SUBMISSION.screenshotUrl}"`);
  });

  it("never shows the context captured for the support team", async () => {
    // A caller passing the internal email's whole input still gets a copy
    // without any of it
    const fullFeedback = { ...SUBMISSION, ...INTERNAL_FIELDS };
    await sendFeedbackCopyEmail(fullFeedback);

    const { subject, text, html } = sentMessage();
    for (const value of INTERNAL_VALUES) {
      expect(subject).not.toContain(value);
      expect(text).not.toContain(value);
      expect(html).not.toContain(value);
    }
    expect(text).not.toContain("Error report");
    expect(html).not.toContain("Error report");
  });

  it("uses the instance's own support address, never a shelf.nu one", async () => {
    await sendFeedbackCopyEmail(SUBMISSION);

    const { replyTo, text, html } = sentMessage();
    expect(replyTo).toBe("help@assets.example.org");
    expect(text).not.toMatch(/@shelf\.nu/i);
    expect(html).not.toMatch(/@shelf\.nu/i);
  });

  it.each([undefined, null, "", "   "])(
    "sends no copy when the submitter's email is %j",
    async (userEmail) => {
      await sendFeedbackCopyEmail({ ...SUBMISSION, userEmail });

      expect(mockSendMail).not.toHaveBeenCalled();
    }
  );

  it("sends no copy when SUPPORT_EMAIL is not configured", async () => {
    // Without it a reply would go to the sender address, not to support
    INSTANCE.supportEmail = undefined;

    await sendFeedbackCopyEmail(SUBMISSION);

    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("sends no copy to a soft-deleted user", async () => {
    await sendFeedbackCopyEmail({
      ...SUBMISSION,
      userEmail: "deleted+user_123@deleted.shelf.nu",
    });

    expect(mockSendMail).not.toHaveBeenCalled();
  });
});

describe("feedbackCopyEmailText", () => {
  it("labels ideas as Idea", () => {
    const text = feedbackCopyEmailText({ ...SUBMISSION, type: "idea" });
    expect(text).toContain("Type: Idea");
  });

  it("omits the screenshot line when nothing was attached", () => {
    const text = feedbackCopyEmailText({ ...SUBMISSION, screenshotUrl: null });
    expect(text).not.toContain("Screenshot");
  });

  it("greets by name, or with a bare Hey when there is none", () => {
    expect(feedbackCopyEmailText(SUBMISSION)).toMatch(/^Hey Jane,/);
    expect(feedbackCopyEmailText({ ...SUBMISSION, firstName: "" })).toMatch(
      /^Hey,/
    );
  });
});

describe("feedbackCopyEmailHtml", () => {
  it("renders the message as text, not markup", async () => {
    const html = await feedbackCopyEmailHtml({
      ...SUBMISSION,
      message: "<img src=x onerror=alert(1)> breaks the page",
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("omits the screenshot link when nothing was attached", async () => {
    const html = await feedbackCopyEmailHtml({
      ...SUBMISSION,
      screenshotUrl: null,
    });
    expect(html).not.toContain("View screenshot");
  });
});
