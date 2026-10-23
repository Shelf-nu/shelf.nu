/**
 * Tests for the push queue worker.
 *
 * Exercises the callback registered with `scheduler.work`, as pg-boss would
 * call it: a `receipts` job disables the devices Expo reports as gone and
 * checks again for receipts Expo has not produced yet, and a failing job is
 * logged only on its last attempt and always rethrown so pg-boss retries it.
 *
 * @see {@link file://./worker.server.ts}
 */
import { Expo } from "expo-server-sdk";
import type PgBoss from "pg-boss";
import {
  pushStore,
  resetPushStore,
  seedOrganization,
  seedPushToken,
} from "@helpers/in-memory-push-db";
import { Logger } from "~/utils/logger";
import { scheduler } from "~/utils/scheduler.server";
import type { PushJob } from "./types";
import { registerPushWorkers } from "./worker.server";

// @vitest-environment node

// why: no database in unit tests; the in-memory store applies the filters
// Postgres would, so a wrong `where` changes the outcome
vi.mock("~/database/db.server", async () => ({
  db: (await import("@helpers/in-memory-push-db")).pushDb,
}));

// why: pg-boss needs a live Postgres; `work` captures the registered callback
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { pushQueue: "push-queue" },
  scheduler: { work: vi.fn(), send: vi.fn(), sendAfter: vi.fn() },
}));

// why: the Expo push service is an external network call; chunking stays real
const expoSend = vi.spyOn(Expo.prototype, "sendPushNotificationsAsync");
// why: the Expo receipts endpoint is an external network call
const expoReceipts = vi.spyOn(
  Expo.prototype,
  "getPushNotificationReceiptsAsync"
);

// why: spying on Logger to assert the retry and receipt logging without pino
// or Sentry
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const NOW = new Date("2026-10-21T12:15:00.000Z");
const SENT_AT = new Date("2026-10-21T12:00:00.000Z");
const GONE_TOKEN = "ExponentPushToken[gone]";
const LIVE_TOKEN = "ExponentPushToken[live]";

type Handler = (job: PgBoss.JobWithMetadata<PushJob>) => Promise<void>;

/** A pg-boss job carrying `data`; overrides win. */
function buildJob(
  data: PushJob,
  overrides: Partial<PgBoss.JobWithMetadata<PushJob>> = {}
): PgBoss.JobWithMetadata<PushJob> {
  return {
    id: "job-1",
    name: "push-queue",
    data,
    retrycount: 0,
    retrylimit: 2,
    ...overrides,
  } as PgBoss.JobWithMetadata<PushJob>;
}

const receiptsJob: PushJob = {
  kind: "receipts",
  tickets: [
    { ticketId: "ticket-1", token: GONE_TOKEN },
    { ticketId: "ticket-2", token: LIVE_TOKEN },
  ],
  sentAt: SENT_AT.toISOString(),
};

const sendJob: PushJob = {
  kind: "send",
  message: {
    userIds: ["user-1"],
    organizationId: "org-paid",
    category: "audits",
    title: "You have been assigned to an audit",
    body: "Warehouse count",
    url: "/audits/audit-1/overview?orgId=org-paid",
  },
};

describe("registerPushWorkers", () => {
  let handler: Handler;
  let queueName: unknown;
  let options: unknown;

  beforeAll(async () => {
    await registerPushWorkers();
    [queueName, options, handler] = vi.mocked(scheduler.work).mock
      .calls[0] as unknown as [string, unknown, Handler];
  });

  beforeEach(() => {
    vi.clearAllMocks();
    expoSend.mockReset();
    expoReceipts.mockReset();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    resetPushStore();
    seedOrganization({ id: "org-paid", userId: "owner-paid" }, "tier_2");
    seedPushToken({
      token: GONE_TOKEN,
      userId: "user-1",
      lastSeenAt: new Date("2026-10-20T00:00:00.000Z"),
    });
    seedPushToken({
      token: LIVE_TOKEN,
      userId: "user-2",
      lastSeenAt: new Date("2026-10-20T00:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("registers the push queue with retry metadata", () => {
    expect(queueName).toBe("push-queue");
    expect(options).toEqual(expect.objectContaining({ includeMetadata: true }));
  });

  it("disables the device a receipt reports as unregistered and leaves the delivered one", async () => {
    expoReceipts.mockResolvedValue({
      "ticket-1": {
        status: "error",
        message: "The device cannot receive push notifications anymore",
        details: { error: "DeviceNotRegistered" },
      },
      "ticket-2": { status: "ok" },
    });

    await handler(buildJob(receiptsJob));

    expect(expoReceipts).toHaveBeenCalledWith(["ticket-1", "ticket-2"]);
    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: GONE_TOKEN, disabledAt: NOW }),
      expect.objectContaining({ token: LIVE_TOKEN, disabledAt: null }),
    ]);
  });

  it("leaves a device that registered again after the send a receipt is about", async () => {
    pushStore.pushTokens[1].lastSeenAt = new Date("2026-10-21T12:05:00.000Z");
    const gone = {
      status: "error" as const,
      message: "The device cannot receive push notifications anymore",
      details: { error: "DeviceNotRegistered" as const },
    };
    expoReceipts.mockResolvedValue({ "ticket-1": gone, "ticket-2": gone });

    await handler(buildJob(receiptsJob));

    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: GONE_TOKEN, disabledAt: NOW }),
      expect.objectContaining({ token: LIVE_TOKEN, disabledAt: null }),
    ]);
  });

  it("alerts on a credentials fault and only warns on other receipt errors", async () => {
    expoReceipts.mockResolvedValue({
      "ticket-1": {
        status: "error",
        message: "Invalid APNs credentials",
        details: { error: "InvalidCredentials" },
      },
      "ticket-2": {
        status: "error",
        message: "Message too big",
        details: { error: "MessageTooBig" },
      },
    });

    await handler(buildJob(receiptsJob));

    expect(Logger.error).toHaveBeenCalledTimes(1);
    expect(Logger.warn).toHaveBeenCalledTimes(1);
    expect(pushStore.pushTokens.every((row) => row.disabledAt === null)).toBe(
      true
    );
  });

  it("checks again in 15 minutes, with the same sentAt, for the tickets Expo has no receipt for yet", async () => {
    const tickets = Array.from({ length: 5 }, (_, index) => ({
      ticketId: `ticket-${index}`,
      token: `ExponentPushToken[device-${index}]`,
    }));
    expoReceipts.mockResolvedValue({
      "ticket-0": { status: "ok" },
      "ticket-2": { status: "ok" },
      "ticket-4": { status: "ok" },
    });

    await handler(
      buildJob({ kind: "receipts", tickets, sentAt: SENT_AT.toISOString() })
    );

    expect(vi.mocked(scheduler.sendAfter).mock.calls).toEqual([
      [
        "push-queue",
        {
          kind: "receipts",
          tickets: [tickets[1], tickets[3]],
          sentAt: SENT_AT.toISOString(),
          recheck: 1,
        },
        { retryLimit: 2, retryDelay: 60, expireInMinutes: 2 },
        new Date(NOW.getTime() + 15 * 60_000),
      ],
    ]);
  });

  it("stops checking once the send is 23 hours old, and logs the tickets left without a receipt", async () => {
    vi.setSystemTime(new Date(SENT_AT.getTime() + 23 * 60 * 60_000));
    expoReceipts.mockResolvedValue({ "ticket-2": { status: "ok" } });

    await handler(buildJob(receiptsJob));

    expect(scheduler.sendAfter).not.toHaveBeenCalled();
    expect(vi.mocked(Logger.warn).mock.calls).toEqual([
      [
        expect.objectContaining({
          label: "Push",
          additionalData: expect.objectContaining({ count: 1 }),
        }),
      ],
    ]);
  });

  it("stops checking after the third re-check", async () => {
    expoReceipts.mockResolvedValue({});

    await handler(buildJob({ ...receiptsJob, recheck: 3 }));

    expect(scheduler.sendAfter).not.toHaveBeenCalled();
    expect(vi.mocked(Logger.warn).mock.calls).toEqual([
      [
        expect.objectContaining({
          additionalData: expect.objectContaining({ count: 2, checks: 4 }),
        }),
      ],
    ]);
  });

  it("runs a send job through the push service", async () => {
    expoSend.mockResolvedValue([{ status: "ok", id: "ticket-9" }]);

    await handler(buildJob(sendJob));

    expect(expoSend).toHaveBeenCalledWith([
      expect.objectContaining({ to: GONE_TOKEN, channelId: "audits" }),
    ]);
  });

  it("rejects a job of a kind it does not know", async () => {
    await expect(
      handler(buildJob({ kind: "digest" } as unknown as PushJob))
    ).rejects.toThrow("Unknown push job kind.");
  });

  it("rethrows a failure so pg-boss retries the job", async () => {
    expoReceipts.mockRejectedValue(new Error("Expo is down"));

    await expect(
      handler(buildJob(receiptsJob, { retrycount: 0, retrylimit: 2 }))
    ).rejects.toThrow("The Expo push service rejected a receipts request.");
  });

  it("does not log on an intermediate attempt", async () => {
    expoReceipts.mockRejectedValue(new Error("Expo is down"));

    await expect(
      handler(buildJob(receiptsJob, { retrycount: 1, retrylimit: 2 }))
    ).rejects.toThrow();

    expect(Logger.error).not.toHaveBeenCalled();
  });

  it("logs once on the final attempt before rethrowing", async () => {
    expoReceipts.mockRejectedValue(new Error("Expo is down"));

    await expect(
      handler(buildJob(receiptsJob, { retrycount: 2, retrylimit: 2 }))
    ).rejects.toThrow();

    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});
