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

  it("sends to every address of a comma separated list", async () => {
    vi.mocked(transporter.sendMail).mockClear();

    await triggerEmail({
      ...basePayload,
      to: "support@shelf.nu, product@shelf.nu",
    });

    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "support@shelf.nu, product@shelf.nu" })
    );
  });

  it("drops only the soft-deleted address from a list", async () => {
    vi.mocked(transporter.sendMail).mockClear();

    await triggerEmail({
      ...basePayload,
      to: "support@shelf.nu, deleted+abc123@deleted.shelf.nu",
    });

    // The live inbox must still get the email, and the soft-deleted one must
    // not: a second call would mean the guard only rewrote the first header
    expect(transporter.sendMail).toHaveBeenCalledOnce();
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "support@shelf.nu" })
    );
  });

  it("skips soft-deleted addresses whatever the domain casing", async () => {
    vi.mocked(transporter.sendMail).mockClear();

    await triggerEmail({
      ...basePayload,
      to: "support@shelf.nu, deleted+abc123@DELETED.SHELF.NU",
    });

    expect(transporter.sendMail).toHaveBeenCalledOnce();
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "support@shelf.nu" })
    );
  });

  it("skips sending when every address in a list is soft-deleted", async () => {
    vi.mocked(transporter.sendMail).mockClear();

    await triggerEmail({
      ...basePayload,
      to: "a@deleted.shelf.nu, b@deleted.shelf.nu",
    });

    expect(transporter.sendMail).not.toHaveBeenCalled();
  });
});
