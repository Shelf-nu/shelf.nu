// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { Logger } from "~/utils/logger";
import { registerEmailWorkers, triggerEmail } from "./email.worker.server";

// why: avoid actual SMTP calls during tests
vi.mock("~/emails/transporter.server", () => ({
  transporter: { sendMail: vi.fn().mockResolvedValue({}) },
}));

// why: env vars are not available in test environment
vi.mock("../utils/env", () => ({
  SMTP_FROM: "test@shelf.nu",
  SUPPORT_EMAIL: "support@shelf.nu",
}));

// why: scheduler is not needed for triggerEmail unit tests
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { emailQueue: "email" },
  scheduler: { work: vi.fn() },
}));

const { transporter } = await import("~/emails/transporter.server");
const { scheduler } = await import("~/utils/scheduler.server");

const basePayload = {
  subject: "Test Subject",
  text: "Test body",
  html: "<p>Test</p>",
};

describe("triggerEmail", () => {
  it("skips sending email to soft-deleted users", async () => {
    await triggerEmail({
      ...basePayload,
      to: "deleted+abc123@deleted.shelf.nu",
    });

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });

  it("sends email to normal addresses", async () => {
    await triggerEmail({
      ...basePayload,
      to: "user@example.com",
    });

    expect(transporter.sendMail).toHaveBeenCalledOnce();
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "user@example.com" })
    );
  });
});

describe("registerEmailWorkers", () => {
  it("logs a permanently failed email without the token in its body", async () => {
    const token =
      "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6Imludml0ZS0xIn0.c2lnbmF0dXJlX3BhcnQ";
    const link = `https://app.shelf.nu/accept-invite/invite-1?token=${token}`;
    // why: the send itself must fail for the final-attempt log to run
    vi.mocked(transporter.sendMail).mockRejectedValueOnce(
      new Error("No recipients defined")
    );
    // why: the log is the thing under test; nothing needs to be written
    const logged = vi.spyOn(Logger, "error").mockImplementation(() => {});

    await registerEmailWorkers();
    // why: pg-boss types the handler for its batch form; this worker is
    // registered with a single-job handler, which is what is called here.
    const handler = vi.mocked(scheduler.work).mock
      .calls[0][2] as unknown as (job: {
      data: unknown;
      retrycount: number;
      retrylimit: number;
    }) => Promise<void>;

    await expect(
      handler({
        data: {
          to: "invitee@example.com",
          subject: "Invite",
          text: link,
          html: `<a href="${link}">Go</a>`,
        },
        retrycount: 15,
        retrylimit: 15,
      })
    ).rejects.toThrow();

    expect(logged).toHaveBeenCalledOnce();
    const error = logged.mock.calls[0][0] as { additionalData: unknown };
    expect(JSON.stringify(error.additionalData)).not.toContain(token);
    expect(error.additionalData).toMatchObject({
      payload: { to: "invitee@example.com", subject: "Invite" },
    });
    logged.mockRestore();
  });
});
