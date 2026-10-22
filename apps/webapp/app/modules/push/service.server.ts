/**
 * Push notifications
 *
 * Sends companion-app pushes and keeps the list of devices current.
 *
 * Feature code calls `sendPush`. It only queues a job and never throws into
 * its caller, the same contract as `sendEmail`. The push worker then runs
 * `deliverPush`, which checks the workspace tier, drops recipients who switched
 * the category off, sends one message per live device through Expo, disables
 * devices Expo reports as gone, and queues `checkPushReceipts` for 15 minutes
 * later to catch devices that fail after Expo hands the message to Apple or
 * Google.
 *
 * Devices are user-scoped, not workspace-scoped: a token belongs to whoever
 * last signed in on that phone, and the workspace on the event decides only
 * whether the push is allowed at all.
 *
 * @see {@link file://./worker.server.ts} the queue worker
 * @see {@link file://./types.ts} the job and message shapes
 * @see {@link file://./preferences.server.ts} the per-person switches
 */
import type { DevicePlatform } from "@prisma/client";
import type { ExpoPushErrorReceipt, ExpoPushTicket } from "expo-server-sdk";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import { filterOrganizationsWithPush } from "~/utils/subscription.server";
import { getPushReceipts, sendPushMessages } from "./expo.server";
import type { DeviceMessage, FailedPushChunk } from "./expo.server";
import { filterRecipientsByPreference } from "./preferences.server";
import type { PushJob, PushMessage, PushTicketRef } from "./types";

/**
 * A push is worth delivering only while it is fresh. Three numbers bound how
 * stale one can get, and they hold together:
 * - `retentionMinutes: 60`: a send job still waiting after an hour (a worker
 *   outage) is dropped by pg-boss instead of delivered late.
 * - `expireInMinutes: 5`: a send still running after five minutes is failed
 *   and retried. pg-boss 9 measures this from the start of a run, not from
 *   when the job was queued.
 * - `MESSAGE_TTL_SECONDS`, four hours: Apple and Google drop a message a phone
 *   has not collected within four hours of Expo accepting it.
 *
 * `deliverPush` asks for a retry by throwing only when Expo issued no ticket
 * and at least one refusal can clear by itself, so a retry resends only
 * batches Expo never acknowledged. Delivery is still at least once, not
 * exactly once: a request that timed out may have reached Expo anyway, and a
 * job killed after Expo accepted a batch but before pg-boss marked it
 * complete expires and runs again, resending that batch. Each Expo request
 * fails after 30 seconds without an answer (see `expo.server.ts`), so a send
 * of a few batches ends well inside the five minutes instead of expiring
 * while it still runs.
 */
const SEND_JOB_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  expireInMinutes: 5,
  retentionMinutes: 60,
};

/** See {@link SEND_JOB_OPTIONS}. */
const MESSAGE_TTL_SECONDS = 4 * 60 * 60;

/**
 * A receipts check makes one Expo request per 300 tickets, each failing after
 * 30 seconds without an answer. Two minutes covers a check of a few requests;
 * one still running after that is stuck, and is retried instead of waiting
 * out pg-boss's 15-minute default. A repeated check is harmless.
 */
const RECEIPTS_JOB_OPTIONS = {
  retryLimit: 2,
  retryDelay: 60,
  expireInMinutes: 2,
};

/** Expo publishes receipts within about 15 minutes and keeps them for a day. */
const RECEIPTS_DELAY_MS = 15 * 60_000;

/**
 * Longest title and body sent, in code points. Asset and booking names can be
 * long, and Expo refuses a message over 4 KB with `MessageTooBig`.
 */
const MAX_TITLE_LENGTH = 100;
const MAX_BODY_LENGTH = 240;

/** Devices kept per person; registering one more drops the least recently seen. */
const MAX_DEVICES_PER_USER = 10;

/** The error codes the Expo SDK reports on a ticket or receipt. */
type ExpoErrorCode = NonNullable<
  NonNullable<ExpoPushErrorReceipt["details"]>["error"]
>;

/**
 * What Shelf does about an undelivered message.
 * - `disableDevice`: the app is gone from the phone, or push is off there.
 *   Stop sending to that token.
 * - `alertOperators`: the push credentials are wrong, so every push fails
 *   until someone fixes the configuration.
 * - `logWarning`: this message failed; nothing to change.
 */
type DeliveryErrorOutcome = "disableDevice" | "alertOperators" | "logWarning";

const DELIVERY_ERROR_OUTCOMES: Record<
  ExpoErrorCode | "MismatchSenderId",
  DeliveryErrorOutcome
> = {
  DeviceNotRegistered: "disableDevice",
  InvalidCredentials: "alertOperators",
  // An FCM code the Expo docs list but the SDK error type omits
  MismatchSenderId: "alertOperators",
  DeveloperError: "logWarning",
  ExpoError: "logWarning",
  MessageRateExceeded: "logWarning",
  MessageTooBig: "logWarning",
  ProviderError: "logWarning",
};

const OUTCOME_BY_CODE = new Map<string, DeliveryErrorOutcome>(
  Object.entries(DELIVERY_ERROR_OUTCOMES)
);

/** A message Expo did not deliver, and the device it was for. */
type DeliveryFailure = { token: string; error: ExpoPushErrorReceipt };

/** Tickets paired with the device each is for, and the batches Expo refused. */
type DeviceSendOutcome = {
  tickets: Array<{ token: string; ticket: ExpoPushTicket }>;
  failedChunks: FailedPushChunk[];
};

/** Context attached to every log line of one send. */
type SendLogContext = { organizationId: string; category: string };

/**
 * Queues a push for the given people. Returns once the job is queued; the
 * tier check, the preference filter and the sending all happen in the worker.
 * Never rejects: a queue failure is logged and the caller carries on, so a
 * push can never break the action that triggered it.
 *
 * @param message - Who to notify, about what, and where a tap should lead
 */
export async function sendPush(message: PushMessage): Promise<void> {
  const userIds = [...new Set(message.userIds)];
  if (userIds.length === 0) return;

  const job: PushJob = { kind: "send", message: { ...message, userIds } };

  try {
    await scheduler.send(QueueNames.pushQueue, job, SEND_JOB_OPTIONS);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to queue a push notification.",
        additionalData: {
          organizationId: message.organizationId,
          category: message.category,
          recipientCount: userIds.length,
        },
        label: "Push",
      })
    );
  }
}

/**
 * Runs a queued push: the body of a `send` job.
 *
 * Every ticket Expo issues is kept, even when other batches are refused. The
 * job throws, so pg-boss retries it, only when Expo issued no ticket at all
 * and at least one refusal can clear by itself (a rate limit, a server error,
 * no answer). Anything else is logged and the job completes, because a retry
 * would resend what Expo already took or fail the same way again.
 *
 * @param message - The push as `sendPush` queued it
 * @throws {ShelfError} When loading recipients fails, or when Expo issued no
 *   ticket and at least one refusal can clear by itself; the cause is that
 *   refusal
 */
export async function deliverPush(message: PushMessage): Promise<void> {
  const { organizationId, category } = message;
  const logContext: SendLogContext = { organizationId, category };

  const [organizationWithPush] = await filterOrganizationsWithPush([
    organizationId,
  ]);
  if (!organizationWithPush) {
    Logger.info(
      "push.send skipped: the workspace tier has no push",
      logContext
    );
    return;
  }

  const recipients = await filterRecipientsByPreference({
    userIds: message.userIds,
    category,
  });
  if (recipients.length === 0) {
    Logger.info(
      "push.send skipped: every recipient switched this category off",
      logContext
    );
    return;
  }

  const devices = await db.pushToken.findMany({
    where: { userId: { in: recipients }, disabledAt: null },
    select: { token: true },
  });
  if (devices.length === 0) {
    Logger.info(
      "push.send skipped: no recipient has a live device",
      logContext
    );
    return;
  }

  const sentAt = new Date();
  const outcome = await resendWithoutForeignProjects(
    await sendToDevices(
      devices.map(({ token }) => token),
      message
    ),
    message,
    sentAt,
    logContext
  );

  const retryableRefusal = outcome.failedChunks.find(
    ({ retryable }) => retryable
  );
  if (outcome.tickets.length === 0 && retryableRefusal) {
    throw new ShelfError({
      cause: retryableRefusal.error,
      message: "The Expo push service refused every push notification request.",
      additionalData: {
        ...logContext,
        devices: devices.length,
        statusCodes: outcome.failedChunks.map(({ statusCode }) => statusCode),
      },
      label: "Push",
    });
  }

  const accepted: PushTicketRef[] = [];
  const failures: DeliveryFailure[] = [];
  for (const { token, ticket } of outcome.tickets) {
    if (ticket.status === "ok") {
      accepted.push({ ticketId: ticket.id, token });
    } else {
      failures.push({ token, error: ticket });
    }
  }

  Logger.info("push.send dispatched", {
    ...logContext,
    devices: devices.length,
    accepted: accepted.length,
    failed: failures.length,
    refused: outcome.failedChunks.reduce(
      (count, { messageCount }) => count + messageCount,
      0
    ),
  });

  try {
    if (accepted.length > 0) {
      const receiptsJob: PushJob = {
        kind: "receipts",
        tickets: accepted,
        sentAt: sentAt.toISOString(),
      };
      await scheduler.sendAfter(
        QueueNames.pushQueue,
        receiptsJob,
        RECEIPTS_JOB_OPTIONS,
        new Date(Date.now() + RECEIPTS_DELAY_MS)
      );
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Push notifications were sent, but queueing their receipts check failed.",
        additionalData: { ...logContext, tickets: accepted.length },
        label: "Push",
      })
    );
  }

  try {
    await handleDeliveryFailures(failures, "ticket", sentAt);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message:
          "Push notifications were sent, but disabling the devices Expo reported as gone failed.",
        additionalData: logContext,
        label: "Push",
      })
    );
  }

  logRefusedChunks(outcome.failedChunks, logContext);
}

/**
 * Reads the delivery receipts for tickets a `send` job collected and disables
 * every device a receipt reports as unregistered: the body of a `receipts` job.
 * A device seen after `sentAt` has registered again since, so it is left
 * alone. Safe to repeat.
 *
 * @param tickets - The accepted tickets and the device each was for
 * @param sentAt - When the send that produced the tickets started
 * @throws {ShelfError} When Expo rejects the request, so pg-boss retries
 */
export async function checkPushReceipts(
  tickets: PushTicketRef[],
  sentAt: Date
): Promise<void> {
  const receipts = await getPushReceipts(
    tickets.map(({ ticketId }) => ticketId)
  );
  const failures = tickets.flatMap(({ ticketId, token }) => {
    const receipt = receipts[ticketId];
    return receipt?.status === "error" ? [{ token, error: receipt }] : [];
  });
  await handleDeliveryFailures(failures, "receipt", sentAt);
}

/** A device registration as the companion app sends it. */
export type PushTokenRegistration = {
  /** The signed-in person, who owns the token from this call on. */
  userId: string;
  token: string;
  platform: DevicePlatform;
  deviceName?: string | null;
  appVersion?: string | null;
};

/**
 * Records that this device can receive pushes for this person. A token
 * already held by someone else moves to the caller (a shared phone, a new
 * sign-in), a disabled token comes back to life, and `lastSeenAt` moves to
 * now. The person keeps their {@link MAX_DEVICES_PER_USER} most recently seen
 * devices; older ones are deleted, unless another person has registered them
 * since. Safe to repeat.
 *
 * @param registration - The device and the person signed in on it
 * @throws {ShelfError} If the database write fails
 */
export async function registerPushToken({
  userId,
  token,
  platform,
  deviceName,
  appVersion,
}: PushTokenRegistration): Promise<void> {
  const device = {
    userId,
    platform,
    deviceName: deviceName ?? null,
    appVersion: appVersion ?? null,
    lastSeenAt: new Date(),
    disabledAt: null,
  };

  try {
    await db.pushToken.upsert({
      where: { token },
      create: { token, ...device },
      update: device,
      select: { id: true },
    });

    const surplus = await db.pushToken.findMany({
      where: { userId },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: MAX_DEVICES_PER_USER,
      select: { id: true },
    });
    if (surplus.length > 0) {
      // A surplus row can move to someone else between the read and the
      // delete (a shared phone signing in again), so the owner is matched too
      await db.pushToken.deleteMany({
        where: { id: { in: surplus.map(({ id }) => id) }, userId },
      });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while registering this device for push notifications.",
      additionalData: { userId, platform },
      label: "Push",
    });
  }
}

/**
 * Forgets a device for this person, on sign-out. A token that belongs to
 * someone else is left alone.
 *
 * @param args.userId - The signed-in person
 * @param args.token - The device token to forget
 * @returns Whether a token of theirs was removed
 * @throws {ShelfError} If the database write fails
 */
export async function unregisterPushToken({
  userId,
  token,
}: {
  userId: string;
  token: string;
}): Promise<boolean> {
  try {
    const { count } = await db.pushToken.deleteMany({
      where: { token, userId },
    });
    return count > 0;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while removing this device from push notifications.",
      additionalData: { userId },
      label: "Push",
    });
  }
}

/**
 * Stops sending to devices Expo reports as unregistered. Tokens that are
 * already disabled keep their original date, and a device seen at or after
 * `seenBefore` has registered again since the report was made, so it stays
 * live.
 *
 * @param tokens - The device tokens to disable
 * @param seenBefore - When the send the report is about started
 */
export async function disablePushTokens(
  tokens: string[],
  seenBefore: Date
): Promise<void> {
  if (tokens.length === 0) return;
  await db.pushToken.updateMany({
    where: {
      token: { in: tokens },
      disabledAt: null,
      lastSeenAt: { lt: seenBefore },
    },
    data: { disabledAt: new Date() },
  });
}

/** Sends `message` to each token and pairs every ticket with its token. */
async function sendToDevices(
  tokens: string[],
  message: PushMessage
): Promise<DeviceSendOutcome> {
  const { tickets, failedChunks } = await sendPushMessages(
    tokens.map((token) => toExpoMessage(token, message))
  );
  return {
    tickets: tickets.map(({ index, ticket }) => ({
      token: tokens[index],
      ticket,
    })),
    failedChunks,
  };
}

/**
 * Recovers from batches Expo refused for mixing Expo projects: disables the
 * tokens of the other projects and sends to Shelf's tokens from those batches
 * once more. A batch refused for any other reason is left as it is.
 */
async function resendWithoutForeignProjects(
  first: DeviceSendOutcome,
  message: PushMessage,
  sentAt: Date,
  logContext: SendLogContext
): Promise<DeviceSendOutcome> {
  const mixes = first.failedChunks.flatMap(({ projectMix }) =>
    projectMix ? [projectMix] : []
  );
  if (mixes.length === 0) return first;

  const foreignTokens = mixes.flatMap(({ foreignTokens }) => foreignTokens);
  try {
    await disablePushTokens(foreignTokens, sentAt);
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Disabling devices registered to another Expo project failed.",
        additionalData: { ...logContext, count: foreignTokens.length },
        label: "Push",
      })
    );
  }

  const retry = await sendToDevices(
    mixes.flatMap(({ shelfTokens }) => shelfTokens),
    message
  );
  return {
    tickets: [...first.tickets, ...retry.tickets],
    failedChunks: [
      ...first.failedChunks.filter(({ projectMix }) => !projectMix),
      ...retry.failedChunks,
    ],
  };
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Cuts `text` to at most `max` code points, ending in an ellipsis when cut.
 * The cut falls between graphemes, so an emoji with a skin tone, a flag or a
 * joined sequence is kept or dropped whole. Length is counted in code points,
 * not graphemes, because one grapheme can hold any number of combining marks
 * and the limit is there to bound the message size.
 */
function truncate(text: string, max: number): string {
  if (Array.from(text).length <= max) return text;
  let kept = "";
  let length = 0;
  for (const { segment } of graphemes.segment(text)) {
    length += Array.from(segment).length;
    if (length > max - 1) break;
    kept += segment;
  }
  return `${kept}…`;
}

/** The Expo message for one device. */
function toExpoMessage(token: string, message: PushMessage): DeviceMessage {
  return {
    to: token,
    title: truncate(message.title, MAX_TITLE_LENGTH),
    body: truncate(message.body, MAX_BODY_LENGTH),
    data: {
      url: message.url,
      category: message.category,
      organizationId: message.organizationId,
    },
    // The companion creates one Android channel per category
    channelId: message.category,
    sound: "default",
    priority: "high",
    ttl: MESSAGE_TTL_SECONDS,
  };
}

/**
 * Logs the batches Expo refused, once per HTTP status, with how many batches
 * and messages each status covered.
 */
function logRefusedChunks(
  failedChunks: FailedPushChunk[],
  logContext: SendLogContext
): void {
  const byStatus = new Map<number | undefined, FailedPushChunk[]>();
  for (const chunk of failedChunks) {
    byStatus.set(chunk.statusCode, [
      ...(byStatus.get(chunk.statusCode) ?? []),
      chunk,
    ]);
  }

  for (const [statusCode, chunks] of byStatus) {
    Logger.error(
      new ShelfError({
        cause: null,
        message: "The Expo push service refused push notification requests.",
        additionalData: {
          ...logContext,
          statusCode,
          codes: [
            ...new Set(chunks.flatMap(({ code }) => (code ? [code] : []))),
          ],
          chunkCount: chunks.length,
          messageCount: chunks.reduce(
            (count, { messageCount }) => count + messageCount,
            0
          ),
        },
        label: "Push",
      })
    );
  }
}

/**
 * Acts on undelivered messages: logs each error code once with its count,
 * then disables gone devices. Only the code, the count and the stage are
 * logged, never Expo's message, which can quote the token.
 */
async function handleDeliveryFailures(
  failures: DeliveryFailure[],
  stage: "ticket" | "receipt",
  sentAt: Date
): Promise<void> {
  const goneTokens: string[] = [];
  const byCode = new Map<
    string,
    { outcome: DeliveryErrorOutcome; count: number }
  >();

  for (const { token, error } of failures) {
    const code = error.details?.error ?? "unknown";
    const outcome = OUTCOME_BY_CODE.get(code) ?? "logWarning";
    if (outcome === "disableDevice") {
      goneTokens.push(token);
      continue;
    }
    byCode.set(code, { outcome, count: (byCode.get(code)?.count ?? 0) + 1 });
  }

  for (const [code, { outcome, count }] of byCode) {
    const alert = outcome === "alertOperators";
    const failure = new ShelfError({
      cause: null,
      message: `Expo could not deliver ${count} push notification(s).`,
      additionalData: { code, count, stage },
      label: "Push",
      shouldBeCaptured: alert,
    });
    if (alert) {
      Logger.error(failure);
    } else {
      Logger.warn(failure);
    }
  }

  await disablePushTokens(goneTokens, sentAt);
}
