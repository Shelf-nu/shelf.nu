/**
 * Tests for the push send pipeline and device registration.
 *
 * Drives `sendPush` the way a caller does, takes the job it queued, and runs
 * that job through `deliverPush` the way the worker does. The database is an
 * in-memory store that applies the same filters Postgres would, so the tier,
 * preference and device rules run for real, and so does the Expo client's
 * chunking: only its network call is replaced.
 *
 * @see {@link file://./service.server.ts}
 */
import { Expo } from "expo-server-sdk";
import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import {
  pushDb,
  pushStore,
  resetPushStore,
  seedOrganization,
  seedPreferences,
  seedPushToken,
} from "@helpers/in-memory-push-db";
import { Logger } from "~/utils/logger";
import { scheduler } from "~/utils/scheduler.server";
import {
  deliverPush,
  registerPushToken,
  sendPush,
  unregisterPushToken,
} from "./service.server";
import { isSafePushUrl } from "./types";
import type { PushJob, PushMessage, PushSendJob } from "./types";

// @vitest-environment node

// why: no database in unit tests; the in-memory store applies the filters
// Postgres would, so a wrong `where` changes the outcome
vi.mock("~/database/db.server", async () => ({
  db: (await import("@helpers/in-memory-push-db")).pushDb,
}));

// why: pg-boss needs a live Postgres; the tests read the jobs it would queue
vi.mock("~/utils/scheduler.server", () => ({
  QueueNames: { pushQueue: "push-queue" },
  scheduler: { send: vi.fn(), sendAfter: vi.fn() },
}));

// why: keeps skip and failure logs out of the output so tests can assert on them
vi.mock("~/utils/logger", () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// why: the Expo push service is an external network call; chunking stays real
const expoSend = vi.spyOn(Expo.prototype, "sendPushNotificationsAsync");

const NOW = new Date("2026-10-21T12:00:00.000Z");
const LIVE_TOKEN = "ExponentPushToken[live]";
const OTHER_TOKEN = "ExponentPushToken[other]";

/** A booking push for user-1 in the paid workspace; overrides win. */
function message(overrides: Partial<PushMessage> = {}): PushMessage {
  return {
    userIds: ["user-1"],
    organizationId: "org-paid",
    category: "bookings",
    title: "Booking reserved",
    body: "Camera kit, Mon 09:00",
    url: "/bookings/booking-1?orgId=org-paid",
    ...overrides,
  };
}

/** Queues a push through `sendPush`, then runs the queued job as the worker would. */
async function sendAndDeliver(overrides: Partial<PushMessage> = {}) {
  vi.mocked(scheduler.send).mockClear();
  await sendPush(message(overrides));
  const job = vi.mocked(scheduler.send).mock.calls[0][1] as PushJob;
  if (job.kind !== "send") throw new Error("expected a send job");
  await deliverPush(job);
}

/** Every message handed to Expo, across all requests, in send order. */
function sentMessages(): ExpoPushMessage[] {
  return expoSend.mock.calls.flatMap(([chunk]) => chunk);
}

/** Accepts every message of a request with a ticket named after its device. */
function acceptChunk(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  return Promise.resolve(
    chunk.map((sent) => ({ status: "ok", id: `ticket-${sent.to}` }))
  );
}

/** An error shaped like the ones the Expo SDK throws for a refused request. */
function expoError(fields: {
  statusCode?: number;
  code?: string;
  details?: unknown;
}) {
  return Object.assign(new Error("Expo refused the request"), fields);
}

/**
 * `error` and every error under it through `cause`, flattened the way the
 * logger writes them: their own fields plus the message and the stack.
 */
function causeChain(error: unknown): object[] {
  const chain: object[] = [];
  let current = error;
  while (current instanceof Error) {
    chain.push({ ...current, message: current.message, stack: current.stack });
    current = current.cause;
  }
  return chain;
}

/** The tokens of every disabled device, in seed order. */
function disabledTokens(): string[] {
  return pushStore.pushTokens
    .filter(({ disabledAt }) => disabledAt !== null)
    .map(({ token }) => token);
}

/** Gives user-1 `count` live devices, `ExponentPushToken[device-<i>]`. */
function seedDevices(count: number) {
  for (const token of deviceTokens(0, count)) {
    seedPushToken({ token, userId: "user-1" });
  }
}

/** The tokens of devices `from` up to, not including, `to`, as seeded. */
function deviceTokens(from: number, to: number): string[] {
  return Array.from(
    { length: to - from },
    (_, offset) => `ExponentPushToken[device-${from + offset}]`
  );
}

/** The tokens of each request handed to Expo, in send order. */
function requestTokens(): string[][] {
  return expoSend.mock.calls.map(([chunk]) => chunk.flatMap(({ to }) => to));
}

/** Every send job queued to run later, in the order queued. */
function queuedFollowUps(): PushSendJob[] {
  return vi.mocked(scheduler.sendAfter).mock.calls.flatMap(([, data]) => {
    const job = data as PushJob;
    return job.kind === "send" ? [job] : [];
  });
}

/** The send job options every push send is queued with. */
const SEND_JOB_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  expireInMinutes: 5,
  retentionMinutes: 60,
};

beforeEach(() => {
  vi.clearAllMocks();
  expoSend.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetPushStore();
  seedOrganization({ id: "org-paid", userId: "owner-paid" }, "tier_1");
  seedOrganization({ id: "org-free", userId: "owner-free" }, "free");
  expoSend.mockImplementation(acceptChunk);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("registerPushToken", () => {
  it("moves a token registered by another user to the caller and revives it", async () => {
    seedPushToken({
      token: LIVE_TOKEN,
      userId: "user-a",
      disabledAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    await registerPushToken({
      userId: "user-b",
      token: LIVE_TOKEN,
      platform: "ANDROID",
      deviceName: "Pixel 8",
      appVersion: "1.7.0",
    });

    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({
        token: LIVE_TOKEN,
        userId: "user-b",
        platform: "ANDROID",
        deviceName: "Pixel 8",
        appVersion: "1.7.0",
        lastSeenAt: NOW,
        disabledAt: null,
      }),
    ]);
  });

  it("keeps one row when the same device registers twice", async () => {
    const registration = {
      userId: "user-a",
      token: LIVE_TOKEN,
      platform: "IOS" as const,
    };

    await registerPushToken(registration);
    await registerPushToken(registration);

    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({
        token: LIVE_TOKEN,
        userId: "user-a",
        platform: "IOS",
        deviceName: null,
        appVersion: null,
        lastSeenAt: NOW,
        disabledAt: null,
      }),
    ]);
  });

  it("keeps the caller's 10 most recently seen devices and drops the oldest", async () => {
    for (let day = 1; day <= 10; day++) {
      seedPushToken({
        token: `ExponentPushToken[day-${day}]`,
        userId: "user-a",
        lastSeenAt: new Date(
          `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`
        ),
      });
    }
    seedPushToken({ token: OTHER_TOKEN, userId: "user-b" });

    await registerPushToken({
      userId: "user-a",
      token: LIVE_TOKEN,
      platform: "IOS",
    });

    const userATokens = pushStore.pushTokens
      .filter(({ userId }) => userId === "user-a")
      .map(({ token }) => token);
    expect(userATokens).toHaveLength(10);
    expect(userATokens).not.toContain("ExponentPushToken[day-1]");
    expect(userATokens).toContain("ExponentPushToken[day-2]");
    expect(userATokens).toContain(LIVE_TOKEN);
    expect(pushStore.pushTokens).toContainEqual(
      expect.objectContaining({ token: OTHER_TOKEN, userId: "user-b" })
    );
  });

  it("leaves a surplus device alone once another user has registered it", async () => {
    for (let day = 1; day <= 11; day++) {
      seedPushToken({
        token: `ExponentPushToken[day-${day}]`,
        userId: "user-a",
        lastSeenAt: new Date(
          `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`
        ),
      });
    }
    const realFindMany = pushDb.pushToken.findMany;
    // why: hands day-1 to user-b between the surplus read and the delete,
    // the window a second registration of that phone can land in
    vi.spyOn(pushDb.pushToken, "findMany").mockImplementationOnce(
      async (args) => {
        const surplus = await realFindMany(args);
        const takenOver = pushStore.pushTokens.find(
          ({ token }) => token === "ExponentPushToken[day-1]"
        );
        if (takenOver) takenOver.userId = "user-b";
        return surplus;
      }
    );

    await registerPushToken({
      userId: "user-a",
      token: LIVE_TOKEN,
      platform: "IOS",
    });

    expect(
      pushStore.pushTokens.map(({ token, userId }) => [token, userId])
    ).toEqual([
      ["ExponentPushToken[day-1]", "user-b"],
      ...Array.from({ length: 9 }, (_, offset) => [
        `ExponentPushToken[day-${offset + 3}]`,
        "user-a",
      ]),
      [LIVE_TOKEN, "user-a"],
    ]);
  });
});

describe("unregisterPushToken", () => {
  it("removes the caller token", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-a" });

    const removed = await unregisterPushToken({
      userId: "user-a",
      token: LIVE_TOKEN,
    });

    expect(removed).toBe(true);
    expect(pushStore.pushTokens).toEqual([]);
  });

  it("leaves a token that belongs to someone else", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-b" });

    const removed = await unregisterPushToken({
      userId: "user-a",
      token: LIVE_TOKEN,
    });

    expect(removed).toBe(false);
    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: LIVE_TOKEN, userId: "user-b" }),
    ]);
  });
});

describe("sendPush", () => {
  it("queues one fresh-only send job naming each recipient once", async () => {
    await sendPush(message({ userIds: ["user-1", "user-1", "user-2"] }));

    expect(scheduler.send).toHaveBeenCalledTimes(1);
    expect(scheduler.send).toHaveBeenCalledWith(
      "push-queue",
      { kind: "send", message: message({ userIds: ["user-1", "user-2"] }) },
      SEND_JOB_OPTIONS
    );
  });

  it("drops and logs a push whose url leaves the app, and still resolves", async () => {
    await expect(
      sendPush(message({ url: "https://evil.example/bookings" }))
    ).resolves.toBeUndefined();

    expect(scheduler.send).not.toHaveBeenCalled();
    expect(vi.mocked(Logger.error).mock.calls).toEqual([
      [
        expect.objectContaining({
          label: "Push",
          additionalData: expect.objectContaining({
            url: "https://evil.example/bookings",
            organizationId: "org-paid",
            category: "bookings",
          }),
        }),
      ],
    ]);
  });

  it("queues nothing when there is no one to notify", async () => {
    await sendPush(message({ userIds: [] }));

    expect(scheduler.send).not.toHaveBeenCalled();
  });

  it("resolves and logs when the queue rejects the job", async () => {
    vi.mocked(scheduler.send).mockRejectedValueOnce(new Error("queue down"));

    await expect(sendPush(message())).resolves.toBeUndefined();

    expect(Logger.error).toHaveBeenCalledTimes(1);
  });
});

describe("isSafePushUrl", () => {
  it.each([
    ["/bookings/abc?orgId=x", true],
    ["/audits/audit-1/overview?orgId=org-paid", true],
    ["https://evil.example", false],
    ["//evil.example", false],
    ["/\\evil", false],
    ["/\t/evil.example", false],
    ["javascript:alert(1)", false],
    ["bookings/abc", false],
    ["", false],
  ])("judges %j safe: %s", (url, safe) => {
    expect(isSafePushUrl(url)).toBe(safe);
  });
});

describe("deliverPush", () => {
  it("sends nothing for a workspace on the free tier, and does for a paid one", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });

    await sendAndDeliver({ organizationId: "org-free" });
    expect(expoSend).not.toHaveBeenCalled();
    expect(scheduler.sendAfter).not.toHaveBeenCalled();

    await sendAndDeliver({ organizationId: "org-paid" });
    expect(expoSend).toHaveBeenCalledTimes(1);
  });

  it("sends exactly one message to the live device and none to the disabled one", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({
      token: OTHER_TOKEN,
      userId: "user-1",
      disabledAt: new Date("2026-10-01T00:00:00.000Z"),
    });

    await sendAndDeliver();

    expect(sentMessages()).toEqual([
      {
        to: LIVE_TOKEN,
        title: "Booking reserved",
        body: "Camera kit, Mon 09:00",
        data: {
          url: "/bookings/booking-1?orgId=org-paid",
          category: "bookings",
          organizationId: "org-paid",
        },
        channelId: "bookings",
        sound: "default",
        priority: "high",
        ttl: 4 * 60 * 60,
      },
    ]);
  });

  it("cuts a title before an emoji that would cross the limit, never inside it", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });

    await sendAndDeliver({ title: `${"t".repeat(98)}👍🏽 and more` });

    expect(sentMessages()).toEqual([
      expect.objectContaining({ title: `${"t".repeat(98)}…` }),
    ]);
  });

  it("drops a grapheme longer than the limit whole, keeping the title within 100 code points", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });

    await sendAndDeliver({ title: `a${"\u0301".repeat(150)}` });

    expect(sentMessages()).toEqual([expect.objectContaining({ title: "…" })]);
  });

  it("cuts a long title to 100 characters and a long body to 240", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });

    await sendAndDeliver({ title: "t".repeat(150), body: "b".repeat(300) });

    expect(sentMessages()).toEqual([
      expect.objectContaining({
        title: `${"t".repeat(99)}…`,
        body: `${"b".repeat(239)}…`,
      }),
    ]);
  });

  it("sends nothing to someone who switched push off", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-2" });
    seedPreferences({ userId: "user-1", pushEnabled: false });

    await sendAndDeliver({ userIds: ["user-1", "user-2"] });

    expect(sentMessages()).toEqual([
      expect.objectContaining({ to: OTHER_TOKEN }),
    ]);
  });

  it("silences only the category that is switched off", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPreferences({ userId: "user-1", bookings: false });

    await sendAndDeliver({ category: "bookings" });
    expect(expoSend).not.toHaveBeenCalled();

    await sendAndDeliver({ category: "audits" });
    expect(sentMessages()).toEqual([
      expect.objectContaining({ to: LIVE_TOKEN, channelId: "audits" }),
    ]);
  });

  it("sends once to a recipient named twice", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });

    await sendAndDeliver({ userIds: ["user-1", "user-1"] });

    expect(sentMessages()).toHaveLength(1);
  });

  it("disables a device Expo reports as unregistered and checks receipts for the rest", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-2" });
    expoSend.mockResolvedValueOnce([
      {
        status: "error",
        message: "The device cannot receive push notifications anymore",
        details: { error: "DeviceNotRegistered", expoPushToken: LIVE_TOKEN },
      },
      { status: "ok", id: "ticket-2" },
    ]);

    await sendAndDeliver({ userIds: ["user-1", "user-2"] });

    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: LIVE_TOKEN, disabledAt: NOW }),
      expect.objectContaining({ token: OTHER_TOKEN, disabledAt: null }),
    ]);
    expect(scheduler.sendAfter).toHaveBeenCalledWith(
      "push-queue",
      {
        kind: "receipts",
        tickets: [{ ticketId: "ticket-2", token: OTHER_TOKEN }],
        sentAt: NOW.toISOString(),
      },
      { retryLimit: 2, retryDelay: 60, expireInMinutes: 2 },
      new Date(NOW.getTime() + 15 * 60_000)
    );
  });

  it("logs a ticket error by code and count, never with the token Expo put in its message", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    expoSend.mockResolvedValueOnce([
      {
        status: "error",
        message: `"${LIVE_TOKEN}" is sending too many messages`,
        details: { error: "MessageRateExceeded", expoPushToken: LIVE_TOKEN },
      },
    ]);

    await sendAndDeliver();

    expect(vi.mocked(Logger.warn).mock.calls).toEqual([
      [
        expect.objectContaining({
          message: "Expo could not deliver 1 push notification(s).",
          additionalData: {
            code: "MessageRateExceeded",
            count: 1,
            stage: "ticket",
          },
        }),
      ],
    ]);
    expect(JSON.stringify(vi.mocked(Logger.warn).mock.calls)).not.toContain(
      LIVE_TOKEN
    );
  });

  it("keeps the first chunk's tickets and tries again a minute later for only the second chunk when Expo answers it with a 503", async () => {
    seedDevices(150);
    expoSend
      .mockImplementationOnce(acceptChunk)
      .mockRejectedValueOnce(expoError({ statusCode: 503 }));

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(vi.mocked(scheduler.sendAfter).mock.calls).toEqual([
      [
        "push-queue",
        {
          kind: "receipts",
          tickets: deviceTokens(0, 100).map((token) => ({
            ticketId: `ticket-${token}`,
            token,
          })),
          sentAt: NOW.toISOString(),
        },
        { retryLimit: 2, retryDelay: 60, expireInMinutes: 2 },
        new Date(NOW.getTime() + 15 * 60_000),
      ],
      [
        "push-queue",
        {
          kind: "send",
          message: message(),
          followUp: { tokens: deviceTokens(100, 150), attempt: 1 },
        },
        SEND_JOB_OPTIONS,
        new Date(NOW.getTime() + 60_000),
      ],
    ]);
    expect(Logger.error).not.toHaveBeenCalled();

    expoSend.mockClear();
    await deliverPush(queuedFollowUps()[0]);

    expect(requestTokens()).toEqual([deviceTokens(100, 150)]);
  });

  it("tries a refused chunk again at most twice, then logs the refusal once per status code", async () => {
    seedDevices(150);
    expoSend
      .mockImplementationOnce(acceptChunk)
      .mockRejectedValue(expoError({ statusCode: 503 }));

    await sendAndDeliver();
    await deliverPush(queuedFollowUps()[0]);
    await expect(deliverPush(queuedFollowUps()[1])).resolves.toBeUndefined();

    expect(queuedFollowUps().map(({ followUp }) => followUp)).toEqual([
      { tokens: deviceTokens(100, 150), attempt: 1 },
      { tokens: deviceTokens(100, 150), attempt: 2 },
    ]);
    expect(requestTokens()).toEqual([
      deviceTokens(0, 100),
      deviceTokens(100, 150),
      deviceTokens(100, 150),
      deviceTokens(100, 150),
    ]);
    expect(vi.mocked(Logger.error).mock.calls).toEqual([
      [
        expect.objectContaining({
          label: "Push",
          additionalData: expect.objectContaining({
            statusCode: 503,
            chunkCount: 1,
            messageCount: 50,
          }),
        }),
      ],
    ]);
  });

  it("sends a follow-up only to listed devices that are still live and still belong to a recipient", async () => {
    const disabledToken = "ExponentPushToken[disabled]";
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-9" });
    seedPushToken({
      token: disabledToken,
      userId: "user-1",
      disabledAt: new Date("2026-10-21T11:59:30.000Z"),
    });
    seedPushToken({ token: "ExponentPushToken[unlisted]", userId: "user-1" });

    await deliverPush({
      kind: "send",
      message: message(),
      followUp: {
        tokens: [LIVE_TOKEN, OTHER_TOKEN, disabledToken],
        attempt: 1,
      },
    });

    expect(requestTokens()).toEqual([[LIVE_TOKEN]]);
  });

  it("logs the refusal when queueing another try fails, and still resolves", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    expoSend.mockRejectedValueOnce(expoError({ statusCode: 503 }));
    vi.mocked(scheduler.sendAfter).mockRejectedValueOnce(
      new Error("queue down")
    );

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(vi.mocked(Logger.error).mock.calls).toEqual([
      [
        expect.objectContaining({
          message:
            "Queueing another try for refused push notifications failed.",
        }),
      ],
      [
        expect.objectContaining({
          additionalData: expect.objectContaining({ statusCode: 503 }),
        }),
      ],
    ]);
  });

  it("pairs each ticket of an accepted second chunk with its own device when the first chunk gets a 500", async () => {
    seedDevices(150);
    expoSend
      .mockRejectedValueOnce(expoError({ statusCode: 500 }))
      .mockImplementationOnce((chunk) =>
        Promise.resolve(
          chunk.map(
            (sent): ExpoPushTicket =>
              sent.to === "ExponentPushToken[device-120]"
                ? {
                    status: "error",
                    message: "The device cannot receive push notifications",
                    details: { error: "DeviceNotRegistered" },
                  }
                : { status: "ok", id: `ticket-${sent.to}` }
          )
        )
      );

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(vi.mocked(scheduler.sendAfter).mock.calls[0][1]).toEqual({
      kind: "receipts",
      tickets: Array.from({ length: 50 }, (_, offset) => 100 + offset)
        .filter((device) => device !== 120)
        .map((device) => ({
          ticketId: `ticket-ExponentPushToken[device-${device}]`,
          token: `ExponentPushToken[device-${device}]`,
        })),
      sentAt: NOW.toISOString(),
    });
    expect(disabledTokens()).toEqual(["ExponentPushToken[device-120]"]);
  });

  it("tries every device again, and completes, when Expo answers every chunk with a 500", async () => {
    seedDevices(150);
    expoSend.mockRejectedValue(expoError({ statusCode: 500 }));

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(
      vi.mocked(scheduler.sendAfter).mock.calls.map(([, job]) => job)
    ).toEqual([
      {
        kind: "send",
        message: message(),
        followUp: { tokens: deviceTokens(0, 150), attempt: 1 },
      },
    ]);
  });

  it("never tries again for a chunk Expo refused with a 400", async () => {
    seedDevices(150);
    expoSend
      .mockRejectedValueOnce(expoError({ statusCode: 400 }))
      .mockRejectedValueOnce(expoError({ statusCode: 503 }));

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(queuedFollowUps()).toEqual([
      {
        kind: "send",
        message: message(),
        followUp: { tokens: deviceTokens(100, 150), attempt: 1 },
      },
    ]);
    expect(vi.mocked(Logger.error).mock.calls).toEqual([
      [
        expect.objectContaining({
          additionalData: expect.objectContaining({
            statusCode: 400,
            chunkCount: 1,
            messageCount: 100,
          }),
        }),
      ],
    ]);
  });

  it("logs a refusal with a cause chain that names no device token", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    expoSend.mockRejectedValueOnce(
      expoError({
        statusCode: 400,
        code: "VALIDATION_ERROR",
        details: { "@shelfassetmanagement/shelf-companion": [LIVE_TOKEN] },
      })
    );

    await sendAndDeliver();

    const chain = causeChain(vi.mocked(Logger.error).mock.calls[0][0]);
    expect(chain.at(-1)).toMatchObject({
      message: "Expo refused the request",
      statusCode: 400,
      code: "VALIDATION_ERROR",
    });
    expect(JSON.stringify(chain)).not.toContain(LIVE_TOKEN);
  });

  it("completes without a retry when Expo refuses the request with a 400", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    expoSend.mockRejectedValue(expoError({ statusCode: 400 }));

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(scheduler.sendAfter).not.toHaveBeenCalled();
    expect(vi.mocked(Logger.error).mock.calls).toEqual([
      [
        expect.objectContaining({
          additionalData: expect.objectContaining({
            statusCode: 400,
            chunkCount: 1,
            messageCount: 1,
          }),
        }),
      ],
    ]);
  });

  it("disables devices of another Expo project and resends to Shelf's devices once", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-1" });
    expoSend.mockRejectedValueOnce(
      expoError({
        statusCode: 400,
        code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
        details: {
          "@shelfassetmanagement/shelf-companion": [LIVE_TOKEN],
          "@someone/another-app": [OTHER_TOKEN],
        },
      })
    );

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(
      expoSend.mock.calls.map(([chunk]) => chunk.map(({ to }) => to))
    ).toEqual([[LIVE_TOKEN, OTHER_TOKEN], [LIVE_TOKEN]]);
    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: LIVE_TOKEN, disabledAt: null }),
      expect.objectContaining({ token: OTHER_TOKEN, disabledAt: NOW }),
    ]);
    expect(vi.mocked(scheduler.sendAfter).mock.calls[0][1]).toEqual({
      kind: "receipts",
      tickets: [{ ticketId: `ticket-${LIVE_TOKEN}`, token: LIVE_TOKEN }],
      sentAt: NOW.toISOString(),
    });
  });

  it("logs and stops when the mixed-projects refusal does not say which token is whose", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-1" });
    expoSend.mockRejectedValueOnce(
      expoError({ statusCode: 400, code: "PUSH_TOO_MANY_EXPERIENCE_IDS" })
    );

    await expect(sendAndDeliver()).resolves.toBeUndefined();

    expect(expoSend).toHaveBeenCalledTimes(1);
    expect(pushStore.pushTokens.map(({ disabledAt }) => disabledAt)).toEqual([
      null,
      null,
    ]);
    expect(vi.mocked(Logger.error).mock.calls).toEqual([
      [
        expect.objectContaining({
          additionalData: expect.objectContaining({
            statusCode: 400,
            codes: ["PUSH_TOO_MANY_EXPERIENCE_IDS"],
          }),
        }),
      ],
    ]);
  });

  it("still schedules the receipts check when disabling a gone device fails", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-2" });
    expoSend.mockResolvedValueOnce([
      {
        status: "error",
        message: "The device cannot receive push notifications anymore",
        details: { error: "DeviceNotRegistered" },
      },
      { status: "ok", id: "ticket-2" },
    ]);
    vi.spyOn(pushDb.pushToken, "updateMany").mockRejectedValueOnce(
      new Error("database down")
    );

    await expect(
      sendAndDeliver({ userIds: ["user-1", "user-2"] })
    ).resolves.toBeUndefined();

    expect(vi.mocked(scheduler.sendAfter).mock.calls[0][1]).toEqual({
      kind: "receipts",
      tickets: [{ ticketId: "ticket-2", token: OTHER_TOKEN }],
      sentAt: NOW.toISOString(),
    });
  });

  it("still disables a gone device when scheduling the receipts check fails", async () => {
    seedPushToken({ token: LIVE_TOKEN, userId: "user-1" });
    seedPushToken({ token: OTHER_TOKEN, userId: "user-2" });
    expoSend.mockResolvedValueOnce([
      {
        status: "error",
        message: "The device cannot receive push notifications anymore",
        details: { error: "DeviceNotRegistered" },
      },
      { status: "ok", id: "ticket-2" },
    ]);
    vi.mocked(scheduler.sendAfter).mockRejectedValueOnce(
      new Error("queue down")
    );

    await expect(
      sendAndDeliver({ userIds: ["user-1", "user-2"] })
    ).resolves.toBeUndefined();

    expect(pushStore.pushTokens).toEqual([
      expect.objectContaining({ token: LIVE_TOKEN, disabledAt: NOW }),
      expect.objectContaining({ token: OTHER_TOKEN, disabledAt: null }),
    ]);
  });
});
