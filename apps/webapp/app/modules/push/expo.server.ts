/**
 * Expo push client
 *
 * The one place the webapp talks to the Expo push service. It splits messages
 * and receipt ids into the batch sizes Expo accepts. Sending never throws:
 * every ticket comes back paired with the index of its message, and every
 * refused batch comes back as a failed chunk saying why, so a caller can keep
 * the tickets Expo did issue and decide for itself whether to retry. Each
 * request gives up after {@link EXPO_REQUEST_TIMEOUT_MS} without an answer.
 *
 * `EXPO_ACCESS_TOKEN` is optional: Expo requires it only once enhanced push
 * security is switched on for the project.
 *
 * @see {@link file://./service.server.ts} the send pipeline that calls this
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */
import { Expo } from "expo-server-sdk";
import type {
  ExpoPushMessage,
  ExpoPushReceipt,
  ExpoPushTicket,
} from "expo-server-sdk";
import { Agent } from "undici";
import { z } from "zod";
import { EXPO_ACCESS_TOKEN } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";

/**
 * The Shelf companion's identity on Expo, as `apps/companion/app.json`
 * declares it: the `@owner/slug` experience id and the EAS project id. Expo
 * keys the tokens of a mixed-projects refusal by project; both forms are
 * listed so the match holds whichever form the key takes.
 */
const SHELF_EXPO_PROJECTS = new Set([
  "@shelfassetmanagement/shelf-companion",
  "b6d6a6cb-c242-4474-815f-b55d5e691c58",
]);

/** The error code Expo gives a request whose tokens span several projects. */
const MIXED_PROJECTS_CODE = "PUSH_TOO_MANY_EXPERIENCE_IDS";

/** The `details` of a mixed-projects refusal: project to its tokens. */
const TokensByProjectSchema = z.record(z.array(z.string()));

/**
 * How long a request waits for Expo's response headers, and then for each
 * part of the body. undici's own default is five minutes, as long as a send
 * job may run before pg-boss expires it and runs it again.
 */
const EXPO_REQUEST_TIMEOUT_MS = 30_000;

/**
 * How many send requests run at once. Six batches of 100 in flight keep a
 * send to a thousand devices at two rounds of requests, so even with every
 * request timing out it ends well inside the send job's five-minute expiry,
 * and match the Expo SDK's own request limit (`maxConcurrentRequests`, 6 by
 * default), which would only queue any more.
 */
const EXPO_SEND_CONCURRENCY = 6;

/**
 * A message for exactly one device. A single `to` keeps one ticket per
 * message, which is what pairs a ticket with its device.
 */
export type DeviceMessage = ExpoPushMessage & { to: string };

/** A ticket and the index of the message it answers. */
export type IndexedPushTicket = { index: number; ticket: ExpoPushTicket };

/** A batch of messages Expo refused as a whole. */
export type FailedPushChunk = {
  /** Position of the batch in send order. */
  index: number;
  /** Index of the batch's first message in the messages sent. */
  firstIndex: number;
  messageCount: number;
  /**
   * The HTTP status of the refusal; `undefined` when no response arrived, or
   * when Expo answered 200 with the wrong number of tickets.
   */
  statusCode: number | undefined;
  /** Expo's error code, when its answer carried one. */
  code: string | undefined;
  /** Whether sending the same batch again later can succeed. */
  retryable: boolean;
  error: ShelfError;
  /**
   * Set when Expo refused the batch for mixing Expo projects and named which
   * token belongs to which, with at least one token of Shelf's own project.
   */
  projectMix?: { shelfTokens: string[]; foreignTokens: string[] };
};

/** What a send produced: the tickets Expo issued and the batches it refused. */
export type SendPushResult = {
  tickets: IndexedPushTicket[];
  failedChunks: FailedPushChunk[];
};

let client: Expo | undefined;

/** The shared Expo client, created on first use. */
function expoClient(): Expo {
  client ??= new Expo({
    accessToken: EXPO_ACCESS_TOKEN || undefined,
    httpAgent: new Agent({
      headersTimeout: EXPO_REQUEST_TIMEOUT_MS,
      bodyTimeout: EXPO_REQUEST_TIMEOUT_MS,
    }),
  });
  return client;
}

/** Reads a field the Expo SDK attaches to the errors it throws. */
function errorField(cause: unknown, field: string): unknown {
  return cause instanceof Error && field in cause
    ? (cause as Error & Record<string, unknown>)[field]
    : undefined;
}

/** The HTTP status the Expo SDK attaches to a failed request, if any. */
function statusCodeOf(cause: unknown): number | undefined {
  const statusCode = errorField(cause, "statusCode");
  return typeof statusCode === "number" ? statusCode : undefined;
}

/** Expo's error code on a failed request, if any. */
function codeOf(cause: unknown): string | undefined {
  const code = errorField(cause, "code");
  return typeof code === "string" ? code : undefined;
}

/**
 * Whether a refusal can clear by itself: a rate limit, a server error, or a
 * request that never got an answer. Any other 4xx fails the same way again.
 * An error without a status counts as no answer only when it also carries no
 * response body (`data` or `errorText`): the SDK throws one with `data` when
 * Expo answered 200 with the wrong number of tickets, and then Expo has taken
 * the batch, so sending it again could deliver it twice.
 */
function isRetryable(cause: unknown): boolean {
  const statusCode = statusCodeOf(cause);
  if (statusCode === undefined) {
    return (
      errorField(cause, "data") === undefined &&
      errorField(cause, "errorText") === undefined
    );
  }
  return statusCode === 429 || statusCode >= 500;
}

/**
 * A copy of an SDK error that keeps what identifies the failure (message,
 * stack, status, code and the network error under it) and drops the rest.
 * `details`, `others` and `data` can list device tokens, and a `ShelfError`
 * cause reaches the logs and Sentry field by field.
 */
function withoutTokens(cause: unknown): unknown {
  if (!(cause instanceof Error)) return cause;
  const copy = new Error(cause.message, { cause: cause.cause });
  copy.name = cause.name;
  copy.stack = cause.stack;
  return Object.assign(copy, {
    statusCode: statusCodeOf(cause),
    code: codeOf(cause),
  });
}

/**
 * Splits the tokens of a mixed-projects refusal into Shelf's and the others.
 * `undefined` when the refusal is of another kind, carries no usable
 * details, or names no Shelf project, since then nothing says which tokens
 * to keep.
 */
function projectMixOf(
  cause: unknown,
  code: string | undefined
): FailedPushChunk["projectMix"] {
  if (code !== MIXED_PROJECTS_CODE) return undefined;
  const details = TokensByProjectSchema.safeParse(errorField(cause, "details"));
  if (!details.success) return undefined;

  const shelfTokens: string[] = [];
  const foreignTokens: string[] = [];
  for (const [project, tokens] of Object.entries(details.data)) {
    (SHELF_EXPO_PROJECTS.has(project) ? shelfTokens : foreignTokens).push(
      ...tokens
    );
  }
  return shelfTokens.length > 0 ? { shelfTokens, foreignTokens } : undefined;
}

/**
 * Runs `task` once per item, at most `limit` at a time, starting them in
 * order, and answers the results in the order of `items`.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function runNext(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, runNext)
  );
  return results;
}

/**
 * Sends push messages in the batch sizes Expo accepts, up to
 * {@link EXPO_SEND_CONCURRENCY} batches at a time. A refused batch does not
 * stop the others.
 *
 * @param messages - One message per device
 * @returns Each issued ticket with the index of its message in `messages`,
 *   and each refused batch, both in send order
 */
export async function sendPushMessages(
  messages: DeviceMessage[]
): Promise<SendPushResult> {
  const chunks = expoClient().chunkPushNotifications(messages);

  // Each message has a single `to`, so chunks hold whole messages in order
  // and a chunk starts where the previous one ended.
  const firstIndexes: number[] = [];
  let firstIndex = 0;
  for (const chunk of chunks) {
    firstIndexes.push(firstIndex);
    firstIndex += chunk.length;
  }

  const outcomes = await mapWithConcurrency(
    chunks,
    EXPO_SEND_CONCURRENCY,
    async (chunk, chunkIndex): Promise<SendPushResult> => {
      const start = firstIndexes[chunkIndex];
      try {
        const tickets = await expoClient().sendPushNotificationsAsync(chunk);
        return {
          tickets: tickets.map((ticket, offset) => ({
            index: start + offset,
            ticket,
          })),
          failedChunks: [],
        };
      } catch (cause) {
        const statusCode = statusCodeOf(cause);
        const code = codeOf(cause);
        return {
          tickets: [],
          failedChunks: [
            {
              index: chunkIndex,
              firstIndex: start,
              messageCount: chunk.length,
              statusCode,
              code,
              retryable: isRetryable(cause),
              error: new ShelfError({
                cause: withoutTokens(cause),
                message:
                  "The Expo push service rejected a push notification request.",
                additionalData: {
                  statusCode,
                  code,
                  chunkIndex,
                  chunkCount: chunks.length,
                  messageCount: chunk.length,
                },
                label: "Push",
              }),
              projectMix: projectMixOf(cause, code),
            },
          ],
        };
      }
    }
  );

  return {
    tickets: outcomes.flatMap(({ tickets }) => tickets),
    failedChunks: outcomes.flatMap(({ failedChunks }) => failedChunks),
  };
}

/**
 * Fetches the delivery receipts for tickets Expo accepted earlier. A receipt
 * missing from the result is not ready yet, has expired, or sat in a request
 * Expo refused; the caller checks those tickets again later. A refused
 * request does not stop the others, so the receipts that did arrive are
 * always acted on. Refusals are logged, and thrown only when every request
 * was refused and nothing arrived.
 *
 * @param ticketIds - Ids from successful tickets
 * @returns Receipts keyed by ticket id
 * @throws {ShelfError} When Expo refuses every request
 */
export async function getPushReceipts(
  ticketIds: string[]
): Promise<Record<string, ExpoPushReceipt>> {
  const receipts: Record<string, ExpoPushReceipt> = {};
  const chunks = expoClient().chunkPushNotificationReceiptIds(ticketIds);
  const refusals: ShelfError[] = [];

  for (const chunk of chunks) {
    try {
      Object.assign(
        receipts,
        await expoClient().getPushNotificationReceiptsAsync(chunk)
      );
    } catch (cause) {
      refusals.push(
        new ShelfError({
          cause: withoutTokens(cause),
          message: "The Expo push service rejected a receipts request.",
          additionalData: {
            statusCode: statusCodeOf(cause),
            ticketCount: ticketIds.length,
            refusedTicketCount: chunk.length,
          },
          label: "Push",
        })
      );
    }
  }

  if (refusals.length > 0 && refusals.length === chunks.length) {
    throw refusals[0];
  }
  for (const refusal of refusals) {
    Logger.error(refusal);
  }

  return receipts;
}
