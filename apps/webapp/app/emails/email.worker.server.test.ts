// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { triggerEmail } from "./email.worker.server";

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
