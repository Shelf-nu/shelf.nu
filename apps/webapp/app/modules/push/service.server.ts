/**
 * Push notifications
 *
 * Sends companion-app pushes and keeps the list of devices current.
 *
 * Feature code calls `sendPush`. It only queues a job and never throws into
 * its caller, the same contract as `sendEmail`. The push worker then runs
 * `deliverPush`, which checks the workspace tier, drops recipients who have left
 * the workspace or switched the category off, sends one message per live
 * device through Expo, disables
 * devices Expo reports as gone, queues another try for batches Expo refused
 * with an error that can clear by itself, and queues `checkPushReceipts` for
 * 15 minutes later to catch devices that fail after Expo hands the message to
 * Apple or Google.
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
import { isSafePushUrl } from "./types";
import type {
  PushFollowUp,
  PushJob,
  PushMessage,
  PushReceiptsJob,
  PushSendJob,
  PushTicketRef,
} from "./types";

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
 * `deliverPush` never throws over an Expo refusal. A batch refused with an
 * error that can clear by itself is tried again by a follow-up send job for
 * just that batch's devices (see {@link MAX_FOLLOW_UPS}), so a batch Expo
 * took is not sent again. pg-boss's own retries cover a run that fails
 * before sending, while loading the tier, the preferences or the devices.
 * Delivery is still at least once, not exactly once: a request that timed
 * out may have reached Expo anyway, and a job killed after Expo accepted a
 * batch but before pg-boss marked it complete expires and runs again,
 * resending that batch. Each Expo request fails after 30 seconds without an
 * answer and six batches go out at once (see `expo.server.ts`), so a send to
 * a few thousand devices ends inside the five minutes instead of expiring
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
 * How many follow-up sends a push gets for batches Expo refused with an error
 * that can clear by itself (a rate limit, a server error, no answer), and how
 * long each waits. A batch still refused on the last follow-up is logged.
 */
const MAX_FOLLOW_UPS = 2;
const FOLLOW_UP_DELAY_MS = 60_000;

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

/**
 * Expo publishes receipts within about 15 minutes and keeps them for a day.
 * A check that finds some receipts not ready yet checks again for those after
 * another {@link RECEIPTS_DELAY_MS}, at most {@link MAX_RECEIPT_RECHECKS}
 * times, and only while the send is under {@link RECEIPT_RECHECK_WINDOW_MS}
 * old so the next check still lands inside Expo's day.
 */
const RECEIPTS_DELAY_MS = 15 * 60_000;
const MAX_RECEIPT_RECHECKS = 3;
const RECEIPT_RECHECK_WINDOW_MS = 23 * 60 * 60_000;

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

/** A batch Expo refused, with the devices its messages were for. */
type RefusedBatch = FailedPushChunk & { tokens: string[] };

/** Tickets paired with the device each is for, and the batches Expo refused. */
type DeviceSendOutcome = {
  tickets: Array<{ token: string; ticket: ExpoPushTicket }>;
  failedChunks: RefusedBatch[];
};

/** Context attached to every log line of one send. */
type SendLogContext = { organizationId: string; category: string };

/**
 * Queues a push for the given people. Returns once the job is queued; the
 * tier check, the preference filter and the sending all happen in the worker.
 * Never rejects: a queue failure, or a url that fails {@link isSafePushUrl},
 * is logged and the push dropped while the caller carries on, so a push can
 * never break the action that triggered it.
 *
 * @param message - Who to notify, about what, and where a tap should lead
 */
export async function sendPush(message: PushMessage): Promise<void> {
  if (!isSafePushUrl(message.url)) {
    Logger.error(
      new ShelfError({
        cause: null,
        message:
          "Dropped a push notification whose url is not a path on the app.",
        additionalData: {
          organizationId: message.organizationId,
          category: message.category,
          url: message.url,
        },
        label: "Push",
      })
    );
    return;
  }

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
 * devices of batches refused with an error that can clear by itself (a rate
 * limit, a server error, no answer) get a follow-up send job a minute later,
 * up to {@link MAX_FOLLOW_UPS} times. Any other refusal, and one still refused
 * on the last follow-up, is logged and the job completes, because trying
 * again would fail the same way.
 *
 * A recipient who is no longer a member of the push's workspace is skipped.
 *
 * A follow-up runs the same tier, membership, preference and device checks,
 * narrowed to its listed devices, so a device signed out, disabled or taken
 * over by someone else since the first try is skipped.
 *
 * @param job - The send job, as `sendPush` or an earlier run queued it
 * @throws {ShelfError} When loading the tier, the memberships, the preferences
 *   or the devices fails, so pg-boss retries
 */
export async function deliverPush({
  message,
  followUp,
}: PushSendJob): Promise<void> {
  const { organizationId, category } = message;
  const logContext: SendLogContext = { organizationId, category };
  const attempt = followUp?.attempt ?? 0;

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

  // Only current members hear about the workspace: revoking access leaves a
  // user on the bookings and audits they were linked to.
  const memberships = await db.userOrganization.findMany({
    where: { organizationId, userId: { in: message.userIds } },
    select: { userId: true },
  });
  const memberIds = new Set(memberships.map(({ userId }) => userId));
  const members = message.userIds.filter((userId) => memberIds.has(userId));
  if (members.length === 0) {
    Logger.info(
      "push.send skipped: no recipient is a member of the workspace",
      logContext
    );
    return;
  }

  const recipients = await filterRecipientsByPreference({
    userIds: members,
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
    where: {
      userId: { in: recipients },
      disabledAt: null,
      ...(followUp && { token: { in: followUp.tokens } }),
    },
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
    attempt,
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

  const retryableBatches = outcome.failedChunks.filter(
    (batch) => batch.retryable
  );
  const followUpQueued =
    retryableBatches.length > 0 &&
    attempt < MAX_FOLLOW_UPS &&
    (await queueFollowUp(
      message,
      {
        tokens: retryableBatches.flatMap(({ tokens }) => tokens),
        attempt: attempt + 1,
      },
      logContext
    ));
  logRefusedChunks(
    followUpQueued
      ? outcome.failedChunks.filter((batch) => !batch.retryable)
      : outcome.failedChunks,
    logContext
  );
}

/**
 * Reads the delivery receipts for tickets a `send` job collected and disables
 * every device a receipt reports as unregistered: the body of a `receipts` job.
 * A device seen after `sentAt` has registered again since, so it is left
 * alone. Tickets Expo has no receipt for yet, including those in a request
 * Expo refused while others went through, are checked again later (see
 * {@link MAX_RECEIPT_RECHECKS}); once the re-checks run out, how many are
 * left is logged. Safe to repeat.
 *
 * @param job - The receipts job `deliverPush` or an earlier check queued
 * @throws {ShelfError} When Expo refuses every request, so pg-boss retries
 * @throws When queueing the next check fails, so pg-boss retries
 */
export async function checkPushReceipts({
  tickets,
  sentAt,
  recheck = 0,
}: PushReceiptsJob): Promise<void> {
  const sendStart = new Date(sentAt);
  const receipts = await getPushReceipts(
    tickets.map(({ ticketId }) => ticketId)
  );

  const failures: DeliveryFailure[] = [];
  const pending: PushTicketRef[] = [];
  for (const ticket of tickets) {
    const receipt = receipts[ticket.ticketId];
    if (!receipt) {
      pending.push(ticket);
    } else if (receipt.status === "error") {
      failures.push({ token: ticket.token, error: receipt });
    }
  }
  await handleDeliveryFailures(failures, "receipt", sendStart);
  if (pending.length === 0) return;

  const age = Date.now() - sendStart.getTime();
  if (recheck >= MAX_RECEIPT_RECHECKS || age >= RECEIPT_RECHECK_WINDOW_MS) {
    Logger.warn(
      new ShelfError({
        cause: null,
        message: `Expo produced no receipt for ${pending.length} push notification(s).`,
        additionalData: { count: pending.length, checks: recheck + 1 },
        label: "Push",
        shouldBeCaptured: false,
      })
    );
    return;
  }

  const nextCheck: PushJob = {
    kind: "receipts",
    tickets: pending,
    sentAt,
    recheck: recheck + 1,
  };
  await scheduler.sendAfter(
    QueueNames.pushQueue,
    nextCheck,
    RECEIPTS_JOB_OPTIONS,
    new Date(Date.now() + RECEIPTS_DELAY_MS)
  );
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

/**
 * Sends `message` to each token and pairs every ticket, and every refused
 * batch, with its tokens.
 */
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
    failedChunks: failedChunks.map((chunk) => ({
      ...chunk,
      tokens: tokens.slice(
        chunk.firstIndex,
        chunk.firstIndex + chunk.messageCount
      ),
    })),
  };
}

/**
 * Queues a follow-up send of `message` to the given devices, a minute from
 * now. A queue failure is logged, not thrown: pg-boss would then run the
 * whole send again and resend the batches Expo already took.
 *
 * @returns Whether the follow-up was queued
 */
async function queueFollowUp(
  message: PushMessage,
  followUp: PushFollowUp,
  logContext: SendLogContext
): Promise<boolean> {
  const job: PushJob = { kind: "send", message, followUp };
  try {
    await scheduler.sendAfter(
      QueueNames.pushQueue,
      job,
      SEND_JOB_OPTIONS,
      new Date(Date.now() + FOLLOW_UP_DELAY_MS)
    );
    Logger.info("push.send follow-up queued", {
      ...logContext,
      attempt: followUp.attempt,
      devices: followUp.tokens.length,
    });
    return true;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Queueing another try for refused push notifications failed.",
        additionalData: {
          ...logContext,
          attempt: followUp.attempt,
          devices: followUp.tokens.length,
        },
        label: "Push",
      })
    );
    return false;
  }
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
 * and messages each status covered. The first batch's error is the cause.
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
        cause: chunks[0].error,
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
