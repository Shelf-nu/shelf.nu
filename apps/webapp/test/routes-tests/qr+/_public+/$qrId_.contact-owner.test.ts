/**
 * Reporting a found item through a QR code.
 *
 * The owner is a property of the organization that claimed the QR, but the owner
 * lookup only ever read it through `qr.asset`. A kit-linked QR has no asset, so
 * the address came back undefined, and because the whole send sits behind that
 * one value, neither the owner NOR the reporter received anything while the page
 * reported success.
 *
 * @see {@link file://./../../../../app/routes/qr+/_public+/$qrId_.contact-owner.tsx}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createActionArgs } from "@mocks/remix";

import { db } from "~/database/db.server";
import { Logger } from "~/utils/logger";
import {
  createReport,
  sendReportEmails,
} from "~/modules/report-found/service.server";

import {
  action,
  NewReportSchema,
  REPORT_CONTENT_MAX_LENGTH,
  REPORT_EMAIL_MAX_LENGTH,
} from "~/routes/qr+/_public+/$qrId_.contact-owner";

// @vitest-environment node

// why: the only read is the QR lookup, stubbed per case below.
vi.mock("~/database/db.server", () => ({
  db: { qr: { findUniqueOrThrow: vi.fn() } },
}));

// why: the rate-limited case asserts that a refusal is not logged again; the
// limiter already logged it, throttled.
vi.mock("~/utils/logger", () => ({
  Logger: {
    error: vi.fn(),
    handledClientError: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
  },
}));

// why: `createReport` writes the row and `sendReportEmails` is the behaviour
// under test. Whether the latter is called at all IS the assertion.
vi.mock("~/modules/report-found/service.server", () => ({
  createReport: vi.fn(),
  sendReportEmails: vi.fn(),
}));

/** An organization whose owner can be emailed. */
const ORG_WITH_OWNER = {
  organization: { owner: { id: "user-owner", email: "owner@example.com" } },
};

async function submit({
  email = "finder@example.com",
  content = "Found this on the train",
  contactOwnerRateLimited = false,
}: {
  email?: string;
  content?: string;
  contactOwnerRateLimited?: boolean;
} = {}) {
  return action(
    createActionArgs({
      request: new Request("http://localhost/qr/qr-1/contact-owner", {
        method: "POST",
        body: new URLSearchParams({ email, content }),
      }),
      params: { qrId: "qr-1" },
      context: {
        getSession: () => ({ userId: null }),
        contactOwnerRateLimited,
      } as never,
    })
  );
}

/** The status of an action result, which is a `data()` response object. */
function statusOf(result: unknown): number | undefined {
  return (result as { init?: { status?: number } }).init?.status;
}

describe("contact owner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createReport).mockResolvedValue({
      id: "report-1",
      content: "Found this on the train",
      email: "finder@example.com",
    } as never);
  });

  it("emails the owner of a kit-linked QR", async () => {
    vi.mocked(db.qr.findUniqueOrThrow).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: "kit-1",
      asset: null,
      kit: { id: "kit-1", name: "Camera kit", ...ORG_WITH_OWNER },
    } as never);

    await submit();

    expect(sendReportEmails).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "owner@example.com" })
    );
  });

  it("still emails the owner of an asset-linked QR", async () => {
    vi.mocked(db.qr.findUniqueOrThrow).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-1",
      kitId: null,
      asset: { id: "asset-1", title: "Drill", ...ORG_WITH_OWNER },
      kit: null,
    } as never);

    await submit();

    expect(sendReportEmails).toHaveBeenCalledWith(
      expect.objectContaining({ ownerEmail: "owner@example.com" })
    );
  });

  it("records the report for a kit QR regardless", async () => {
    vi.mocked(db.qr.findUniqueOrThrow).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: null,
      kitId: "kit-1",
      asset: null,
      kit: { id: "kit-1", name: "Camera kit", ...ORG_WITH_OWNER },
    } as never);

    await submit();

    expect(createReport).toHaveBeenCalledWith(
      expect.objectContaining({ kitId: "kit-1" })
    );
  });

  it("refuses a submission over the rate limit before any query or email", async () => {
    const result = await submit({ contactOwnerRateLimited: true });

    expect(statusOf(result)).toBe(429);
    expect(
      (result as { data: { error: { message: string } } }).data.error.message
    ).toMatch(/too many messages/i);
    // The limiter logged the hit already; the refusal adds no log of its own.
    expect(Logger.error).not.toHaveBeenCalled();
    expect(Logger.handledClientError).not.toHaveBeenCalled();
    expect(db.qr.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(createReport).not.toHaveBeenCalled();
    expect(sendReportEmails).not.toHaveBeenCalled();
  });

  it("refuses a message over the length cap without recording it", async () => {
    vi.mocked(db.qr.findUniqueOrThrow).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-1",
      kitId: null,
      asset: { id: "asset-1", title: "Drill", ...ORG_WITH_OWNER },
      kit: null,
    } as never);

    const result = await submit({
      content: "x".repeat(REPORT_CONTENT_MAX_LENGTH + 1),
    });

    expect(statusOf(result)).toBe(400);
    expect(createReport).not.toHaveBeenCalled();
    expect(sendReportEmails).not.toHaveBeenCalled();
  });

  it("refuses an email address over the length cap without recording it", async () => {
    vi.mocked(db.qr.findUniqueOrThrow).mockResolvedValue({
      id: "qr-1",
      organizationId: "org-1",
      assetId: "asset-1",
      kitId: null,
      asset: { id: "asset-1", title: "Drill", ...ORG_WITH_OWNER },
      kit: null,
    } as never);

    const result = await submit({
      email: `${"a".repeat(REPORT_EMAIL_MAX_LENGTH)}@example.com`,
    });

    expect(statusOf(result)).toBe(400);
    expect(createReport).not.toHaveBeenCalled();
    expect(sendReportEmails).not.toHaveBeenCalled();
  });

  it("stops at the length check, so an oversized email never reaches the email regex", () => {
    // Oversized and malformed: if the email check ran, it would add an issue.
    const result = NewReportSchema.safeParse({
      email: "a".repeat(REPORT_EMAIL_MAX_LENGTH + 1),
      content: "Found this on the train",
    });

    expect(result.success).toBe(false);
    const emailIssues = result.error?.issues.filter(
      (issue) => issue.path[0] === "email"
    );
    expect(emailIssues?.map((issue) => issue.code)).toEqual(["too_big"]);
  });
});
