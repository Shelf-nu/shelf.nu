// @vitest-environment node
/**
 * Unit tests for the email send wrappers.
 *
 * `sendEmailAndWait` is what a paced fan-out awaits between recipients, so its
 * promise has to cover the queue fallback too: if it settled as soon as the
 * direct send failed, the caller would move on while the enqueue was still in
 * flight and the pacing would be gone.
 *
 * @see {@link file://./mail.server.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { scheduler } from "~/utils/scheduler.server";
import { triggerEmail } from "./email.worker.server";
import { sendEmailAndWait } from "./mail.server";

// why: the direct send talks to SMTP; each test decides whether it succeeds.
vi.mock("./email.worker.server", () => ({
  triggerEmail: vi.fn(),
}));

// why: the fallback queue is pg-boss, which needs a database; the stub lets a
// test hold the enqueue open and observe what waits for it.
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { emailQueue: "email-queue" },
  scheduler: { send: vi.fn() },
}));

// why: the failed direct send is logged; keep the expected error out of the
// test output.
vi.mock("~/utils/logger", () => ({
  Logger: { error: vi.fn() },
}));

const payload = {
  to: "test@example.com",
  subject: "ZZ Test subject",
  text: "Test body",
  html: "<p>Test body</p>",
};

/** Lets every already-queued microtask and timer callback run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("sendEmailAndWait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves after a successful direct send without touching the queue", async () => {
    vi.mocked(triggerEmail).mockResolvedValue(undefined);

    await expect(sendEmailAndWait(payload)).resolves.toBe(true);

    expect(triggerEmail).toHaveBeenCalledWith(payload);
    expect(scheduler.send).not.toHaveBeenCalled();
  });

  it("resolves only after the queue fallback has finished when the direct send rejects", async () => {
    vi.mocked(triggerEmail).mockRejectedValue(new Error("SMTP unavailable"));
    let finishEnqueue: (jobId: string) => void = () => {};
    vi.mocked(scheduler.send).mockReturnValue(
      new Promise<string>((resolve) => {
        finishEnqueue = resolve;
      }) as never
    );

    let settled = false;
    const waiting = sendEmailAndWait(payload).then((handedOff) => {
      settled = true;
      return handedOff;
    });

    await flush();
    // The direct send has failed and the enqueue has started, but it has not
    // finished: the caller must still be waiting.
    expect(scheduler.send).toHaveBeenCalledWith(
      "email-queue",
      payload,
      expect.objectContaining({ retryLimit: 15 })
    );
    expect(settled).toBe(false);

    finishEnqueue("job-1");
    // Queued for retry counts as handed off.
    await expect(waiting).resolves.toBe(true);
    expect(settled).toBe(true);
  });

  it("resolves false, without rejecting, when the send and the enqueue both fail", async () => {
    vi.mocked(triggerEmail).mockRejectedValue(new Error("SMTP unavailable"));
    vi.mocked(scheduler.send).mockRejectedValue(new Error("queue down"));

    await expect(sendEmailAndWait(payload)).resolves.toBe(false);
  });
});
