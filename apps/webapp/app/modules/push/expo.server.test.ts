/**
 * Tests for the Expo push client boundary.
 *
 * Only the two network calls of the `Expo` class are replaced; its real
 * chunking runs, so these tests pin how messages split into requests, how
 * each ticket finds its message again, and what a refused request reports.
 * One test lets a request through to a local server that never answers, to
 * pin how long the client waits for Expo.
 *
 * @see {@link file://./expo.server.ts}
 */
import { Expo } from "expo-server-sdk";
import type { ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { ShelfError } from "~/utils/error";
import { getPushReceipts, sendPushMessages } from "./expo.server";
import type { DeviceMessage } from "./expo.server";

// @vitest-environment node

// why: the SDK reads EXPO_BASE_URL once, when it loads, so the silent server
// has to listen before any import; it accepts requests and never answers
const silentExpo = await vi.hoisted(async () => {
  const { createServer } = await import("node:http");
  const server = createServer(() => {});
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the silent Expo server has no port");
  }
  process.env.EXPO_BASE_URL = `http://127.0.0.1:${address.port}`;
  return server;
});

const realSend = Expo.prototype.sendPushNotificationsAsync;
// why: the Expo push service is an external network call; chunking stays real
const sendSpy = vi.spyOn(Expo.prototype, "sendPushNotificationsAsync");
// why: the Expo receipts endpoint is an external network call
const receiptsSpy = vi.spyOn(
  Expo.prototype,
  "getPushNotificationReceiptsAsync"
);

/** `count` messages, one per device `ExponentPushToken[device-<i>]`. */
function messages(count: number): DeviceMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    to: `ExponentPushToken[device-${index}]`,
    title: "Booking reserved",
  }));
}

/** An accepted ticket per message whose id names the message's device. */
function acceptChunk(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  return Promise.resolve(
    chunk.map((message) => ({ status: "ok", id: `ticket-${message.to}` }))
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

beforeEach(() => {
  sendSpy.mockReset();
  receiptsSpy.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  silentExpo.closeAllConnections();
});

afterAll(() => {
  silentExpo.close();
});

describe("sendPushMessages", () => {
  it("sends 150 messages as a chunk of 100 and a chunk of 50, pairing each ticket with its message", async () => {
    sendSpy.mockImplementation(acceptChunk);

    const result = await sendPushMessages(messages(150));

    expect(sendSpy.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      100, 50,
    ]);
    expect(sendSpy.mock.calls[1][0][0].to).toBe(
      "ExponentPushToken[device-100]"
    );
    expect(result.failedChunks).toEqual([]);
    expect(result.tickets).toHaveLength(150);
    expect(result.tickets[0]).toEqual({
      index: 0,
      ticket: { status: "ok", id: "ticket-ExponentPushToken[device-0]" },
    });
    expect(result.tickets[149]).toEqual({
      index: 149,
      ticket: { status: "ok", id: "ticket-ExponentPushToken[device-149]" },
    });
  });

  it("keeps the first chunk's tickets and reports the second chunk when Expo answers it with a 500", async () => {
    sendSpy
      .mockImplementationOnce(acceptChunk)
      .mockRejectedValueOnce(expoError({ statusCode: 500 }));

    const result = await sendPushMessages(messages(150));

    expect(result.tickets.map(({ index }) => index)).toEqual(
      Array.from({ length: 100 }, (_, index) => index)
    );
    expect(result.failedChunks).toEqual([
      {
        index: 1,
        firstIndex: 100,
        messageCount: 50,
        statusCode: 500,
        code: undefined,
        retryable: true,
        error: expect.any(ShelfError),
      },
    ]);
    expect(result.failedChunks[0].error).toMatchObject({
      label: "Push",
      additionalData: { statusCode: 500, chunkIndex: 1, chunkCount: 2 },
    });
  });

  it("pairs the second chunk's tickets with messages 100 to 149 when the first chunk fails", async () => {
    sendSpy
      .mockRejectedValueOnce(expoError({ statusCode: 503 }))
      .mockImplementationOnce(acceptChunk);

    const result = await sendPushMessages(messages(150));

    expect(result.tickets[0]).toEqual({
      index: 100,
      ticket: { status: "ok", id: "ticket-ExponentPushToken[device-100]" },
    });
    expect(result.tickets.at(-1)).toEqual({
      index: 149,
      ticket: { status: "ok", id: "ticket-ExponentPushToken[device-149]" },
    });
    expect(result.failedChunks.map(({ index }) => index)).toEqual([0]);
  });

  it.each([
    {
      case: "a rate limit",
      cause: expoError({ statusCode: 429 }),
      statusCode: 429,
      retryable: true,
    },
    {
      case: "a server error",
      cause: expoError({ statusCode: 502 }),
      statusCode: 502,
      retryable: true,
    },
    {
      case: "a bad request",
      cause: expoError({ statusCode: 400 }),
      statusCode: 400,
      retryable: false,
    },
    {
      case: "bad credentials",
      cause: expoError({ statusCode: 401 }),
      statusCode: 401,
      retryable: false,
    },
    {
      case: "no answer",
      cause: new TypeError("fetch failed"),
      statusCode: undefined,
      retryable: true,
    },
    {
      case: "a 200 with the wrong number of tickets",
      cause: Object.assign(
        new Error("Expected Expo to respond with 1 ticket but got 2"),
        {
          data: [
            { status: "ok", id: "ticket-a" },
            { status: "ok", id: "ticket-b" },
          ],
        }
      ),
      statusCode: undefined,
      retryable: false,
    },
    {
      case: "a text body without a status",
      cause: Object.assign(new Error("Expo responded with an error"), {
        errorText: "upstream reset",
      }),
      statusCode: undefined,
      retryable: false,
    },
  ])(
    "reads $case as status $statusCode, retryable: $retryable",
    async ({ cause, statusCode, retryable }) => {
      sendSpy.mockRejectedValueOnce(cause);

      const { failedChunks } = await sendPushMessages(messages(1));

      expect(failedChunks).toEqual([
        expect.objectContaining({ index: 0, statusCode, retryable }),
      ]);
    }
  );

  it("gives up on a request Expo leaves unanswered after 30 seconds and reports it as retryable", async () => {
    // why: this request goes to the silent local server, never to Expo
    sendSpy.mockImplementation(function (this: Expo, chunk) {
      return realSend.call(this, chunk);
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const requestArrived = new Promise<void>((resolve) => {
      silentExpo.once("request", () => resolve());
    });
    let settled = false;
    const sending = sendPushMessages(messages(1)).finally(() => {
      settled = true;
    });

    await requestArrived;
    await vi.advanceTimersByTimeAsync(32_000);

    expect(settled).toBe(true);
    expect((await sending).failedChunks).toEqual([
      expect.objectContaining({
        index: 0,
        statusCode: undefined,
        retryable: true,
      }),
    ]);
  });

  it("splits the tokens of a request that mixed Expo projects into Shelf's and the others", async () => {
    sendSpy.mockRejectedValueOnce(
      expoError({
        statusCode: 400,
        code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
        details: {
          "@shelfassetmanagement/shelf-companion": [
            "ExponentPushToken[device-0]",
          ],
          "@someone/another-app": ["ExponentPushToken[device-1]"],
        },
      })
    );

    const { failedChunks } = await sendPushMessages(messages(2));

    expect(failedChunks).toEqual([
      expect.objectContaining({
        statusCode: 400,
        code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
        retryable: false,
        projectMix: {
          shelfTokens: ["ExponentPushToken[device-0]"],
          foreignTokens: ["ExponentPushToken[device-1]"],
        },
      }),
    ]);
  });

  it.each([
    { case: "has no details", details: undefined },
    {
      case: "names no Shelf project",
      details: { "@someone/another-app": ["ExponentPushToken[device-1]"] },
    },
  ])(
    "leaves the project split out when the mixed-projects refusal $case",
    async ({ details }) => {
      sendSpy.mockRejectedValueOnce(
        expoError({
          statusCode: 400,
          code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
          details,
        })
      );

      const { failedChunks } = await sendPushMessages(messages(2));

      expect(failedChunks).toEqual([
        expect.objectContaining({
          code: "PUSH_TOO_MANY_EXPERIENCE_IDS",
          projectMix: undefined,
        }),
      ]);
    }
  );
});

describe("getPushReceipts", () => {
  it("asks for 450 receipts as a request of 300 and one of 150 and merges the answers", async () => {
    const ids = Array.from({ length: 450 }, (_, index) => `ticket-${index}`);
    receiptsSpy.mockImplementation((chunk) =>
      Promise.resolve(
        Object.fromEntries(chunk.map((id) => [id, { status: "ok" as const }]))
      )
    );

    const receipts = await getPushReceipts(ids);

    expect(receiptsSpy.mock.calls.map(([chunk]) => chunk.length)).toEqual([
      300, 150,
    ]);
    expect(receiptsSpy.mock.calls[1][0][0]).toBe("ticket-300");
    expect(Object.keys(receipts)).toHaveLength(450);
    expect(receipts["ticket-449"]).toEqual({ status: "ok" });
  });

  it("rejects with a Push error carrying the status when Expo refuses a request", async () => {
    receiptsSpy.mockRejectedValueOnce(expoError({ statusCode: 503 }));

    await expect(getPushReceipts(["ticket-1"])).rejects.toMatchObject({
      label: "Push",
      message: "The Expo push service rejected a receipts request.",
      additionalData: { statusCode: 503, ticketCount: 1 },
    });
  });
});
