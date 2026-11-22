/**
 * Tests for {@link createNotificationBus}: how toasts travel through Postgres
 * LISTEN/NOTIFY, when they fall back to this machine's emitter, and how a lost
 * connection is retried.
 *
 * The pg client is replaced by an injected fake (an EventEmitter with
 * `connect`, `query` and `end` stubs), so no module mocking is needed.
 *
 * @see {@link file://./notification-bus.server.ts}
 */
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ShelfError } from "../error";
import { emitter } from "./emitter.server";
import {
  createNotificationBus,
  listenerClientConfig,
  NOTIFICATION_CHANNEL,
  publishNotification,
  startNotificationBus,
  type BusClient,
  type NotificationBus,
} from "./notification-bus.server";

const NOTIFY_SQL = "SELECT pg_notify($1, $2)";

/** Stands in for a pg.Client: real events, stubbed network calls */
class FakeClient extends EventEmitter {
  // why: a real pg client needs a live Postgres; the bus calls only these three
  // network methods, and notification-bus.db.test.ts covers the real database
  connect = vi.fn(() => Promise.resolve());
  query = vi.fn((_text: string, _values?: unknown[]) => Promise.resolve({}));
  end = vi.fn(() => Promise.resolve());
}

/** Buses created by a test, stopped afterwards so no retry timer leaks */
const buses: NotificationBus[] = [];

/**
 * Builds a bus whose clients are fakes.
 *
 * @param configure - Adjusts each fake before the bus uses it
 */
function setup(configure?: (client: FakeClient) => void) {
  const clients: FakeClient[] = [];
  // why: the injected factory is the seam that swaps out the external pg
  // client; the spy counts how many clients the bus builds
  const createClient = vi.fn(() => {
    const client = new FakeClient();
    configure?.(client);
    clients.push(client);
    // The fake implements only the members the bus calls
    return client as unknown as BusClient;
  });
  // why: spies on the injected emitter and logger, so tests assert what was
  // delivered and reported without the real emitter or Sentry
  const emitLocal = vi.fn<(payload: string) => void>();
  const logError = vi.fn<(error: ShelfError) => void>();
  const logWarning = vi.fn<(error: ShelfError) => void>();
  const bus = createNotificationBus({
    createClient,
    emitLocal,
    logError,
    logWarning,
  });
  buses.push(bus);
  return { bus, clients, createClient, emitLocal, logError, logWarning };
}

/** Lets chained promise callbacks (connect, LISTEN, catch) run */
async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

afterEach(async () => {
  await Promise.all(buses.splice(0).map((bus) => bus.stop()));
  vi.useRealTimers();
});

describe("createNotificationBus", () => {
  it("listens on shelf_notification after start", async () => {
    const { bus, clients } = setup();

    await bus.start();

    expect(clients[0].query).toHaveBeenCalledWith("LISTEN shelf_notification");
    expect(bus.isListening()).toBe(true);
  });

  it("re-emits notifications from its channel only", async () => {
    const { bus, clients, emitLocal } = setup();
    await bus.start();

    clients[0].emit("notification", {
      processId: 1,
      channel: NOTIFICATION_CHANNEL,
      payload: "a",
    });
    clients[0].emit("notification", {
      processId: 1,
      channel: "other",
      payload: "b",
    });
    clients[0].emit("notification", {
      processId: 1,
      channel: NOTIFICATION_CHANNEL,
      payload: "",
    });

    expect(emitLocal).toHaveBeenCalledTimes(1);
    expect(emitLocal).toHaveBeenCalledWith("a");
  });

  it("publishes with pg_notify when listening", async () => {
    const { bus, clients } = setup();
    await bus.start();

    bus.publish("x");

    expect(clients[0].query).toHaveBeenCalledWith(NOTIFY_SQL, [
      "shelf_notification",
      "x",
    ]);
  });

  it("does not emit locally when pg_notify succeeds", async () => {
    const { bus, emitLocal } = setup();
    await bus.start();

    bus.publish("x");
    await flush();

    expect(emitLocal).not.toHaveBeenCalled();
  });

  it("publishes locally while disconnected", () => {
    const { bus, createClient, emitLocal } = setup();

    bus.publish("x");

    expect(emitLocal).toHaveBeenCalledWith("x");
    // No client exists yet, so nothing can have been queried
    expect(createClient).not.toHaveBeenCalled();
  });

  it("falls back locally when pg_notify fails", async () => {
    const { bus, emitLocal, logError } = setup((client) => {
      client.query.mockImplementation((text: string) =>
        text === NOTIFY_SQL
          ? Promise.reject(new Error("notify failed"))
          : Promise.resolve({})
      );
    });
    await bus.start();

    bus.publish("x");
    await flush();

    expect(emitLocal).toHaveBeenCalledTimes(1);
    expect(emitLocal).toHaveBeenCalledWith("x");
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("falls back locally above the payload cap", async () => {
    const { bus, clients, emitLocal, logError } = setup();
    await bus.start();
    // "é" is two bytes in UTF-8, so this is 8000 bytes
    const payload = "é".repeat(4000);

    bus.publish(payload);

    expect(emitLocal).toHaveBeenCalledWith(payload);
    expect(clients[0].query).not.toHaveBeenCalledWith(
      NOTIFY_SQL,
      expect.anything()
    );
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("reconnects after the connection ends", async () => {
    vi.useFakeTimers();
    const { bus, clients, createClient } = setup();
    await bus.start();

    clients[0].emit("end");

    expect(bus.isListening()).toBe(false);
    expect(clients[0].end).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(clients[1].query).toHaveBeenCalledWith("LISTEN shelf_notification");
    expect(bus.isListening()).toBe(true);
  });

  it("backs off and caps the delay", async () => {
    vi.useFakeTimers();
    const { bus, createClient, logError, logWarning } = setup((client) => {
      client.connect.mockRejectedValue(new Error("connection refused"));
    });
    await bus.start();
    expect(createClient).toHaveBeenCalledTimes(1);

    const expectedDelays = [1000, 2000, 5000, 10000, 30000, 30000];
    for (const [index, delay] of expectedDelays.entries()) {
      // Nothing happens a millisecond early...
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(createClient).toHaveBeenCalledTimes(index + 1);
      // ...and the retry fires exactly on time
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(createClient).toHaveBeenCalledTimes(index + 2);
    }

    // The first failure is an error, every retry after it a warning
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledTimes(expectedDelays.length);
  });

  it("reconnects after a client error", async () => {
    vi.useFakeTimers();
    const { bus, clients, createClient, logError } = setup();
    await bus.start();

    clients[0].emit("error", new Error("socket reset"));

    expect(bus.isListening()).toBe(false);
    expect(clients[0].end).toHaveBeenCalled();
    expect(logError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await flush();

    expect(createClient).toHaveBeenCalledTimes(2);
    expect(bus.isListening()).toBe(true);
  });

  it("keeps backing off when a connection drops right after LISTEN", async () => {
    vi.useFakeTimers();
    const { bus, clients, createClient, logError, logWarning } = setup();
    await bus.start();

    clients[0].emit("end");
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    clients[1].emit("end");

    // The second drop came within the stable window, so the delay grows
    await vi.advanceTimersByTimeAsync(1999);
    expect(createClient).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(createClient).toHaveBeenCalledTimes(3);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logWarning).toHaveBeenCalledTimes(1);
  });

  it("starts the backoff over after a stable connection", async () => {
    vi.useFakeTimers();
    const { bus, clients, createClient, logError } = setup();
    await bus.start();

    clients[0].emit("end");
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    await vi.advanceTimersByTimeAsync(30000);
    clients[1].emit("end");

    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(createClient).toHaveBeenCalledTimes(3);
    // A drop after a stable connection starts a new streak, so it is an error
    expect(logError).toHaveBeenCalledTimes(2);
  });

  it("does not throw when the local emitter throws", async () => {
    const { bus, clients, emitLocal, logError } = setup();
    emitLocal.mockImplementation(() => {
      throw new Error("bad payload");
    });
    await bus.start();

    expect(() =>
      clients[0].emit("notification", {
        processId: 1,
        channel: NOTIFICATION_CHANNEL,
        payload: "not json",
      })
    ).not.toThrow();
    expect(() => bus.publish("x".repeat(8000))).not.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Failed to deliver notification on this server",
      })
    );
  });

  it("start never rejects when the client cannot be built", async () => {
    vi.useFakeTimers();
    // why: a real pg.Client cannot be made to throw on construction on demand;
    // this stands in for one built from a malformed URL
    const createClient = vi.fn((): BusClient => {
      throw new TypeError("Invalid URL");
    });
    // why: spy on the injected logger to count reported errors
    const logError = vi.fn<(error: ShelfError) => void>();
    const bus = createNotificationBus({
      createClient,
      // why: required by the bus options, not under test here
      emitLocal: vi.fn(),
      logError,
    });
    buses.push(bus);

    await expect(bus.start()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(30000);

    expect(bus.isListening()).toBe(false);
    expect(logError).toHaveBeenCalledTimes(1);
    // The same URL would fail again, so no retry is scheduled
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("start never rejects when connect fails", async () => {
    const { bus } = setup((client) => {
      client.connect.mockRejectedValue(new Error("connection refused"));
    });

    await expect(bus.start()).resolves.toBeUndefined();
    expect(bus.isListening()).toBe(false);
  });

  it("logged connection errors do not contain the password", async () => {
    const { bus, logError } = setup((client) => {
      client.connect.mockRejectedValue(
        new Error("could not connect to postgres://u:s3cret@h:5432/db")
      );
    });

    await bus.start();

    expect(logError).toHaveBeenCalled();
    for (const [error] of logError.mock.calls) {
      const cause = error.cause as Error;
      expect(error.message).not.toContain("s3cret");
      expect(cause.message).not.toContain("s3cret");
      expect(cause.stack ?? "").not.toContain("s3cret");
    }
  });

  it("stop cancels a pending reconnect", async () => {
    vi.useFakeTimers();
    const { bus, clients, createClient } = setup();
    await bus.start();

    clients[0].emit("end");
    await bus.stop();
    await vi.advanceTimersByTimeAsync(30000);

    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe("listenerClientConfig", () => {
  it("keeps the idle connection alive and bounds every wait", () => {
    expect(listenerClientConfig("postgres://u:p@h:5432/db")).toEqual({
      connectionString: "postgres://u:p@h:5432/db",
      keepAlive: true,
      keepAliveInitialDelayMillis: 30000,
      connectionTimeoutMillis: 10000,
      query_timeout: 5000,
    });
  });
});

describe("startNotificationBus without a direct connection string", () => {
  it("creates no bus and publishNotification keeps using the local emitter", async () => {
    const received: string[] = [];
    const listener = (payload: string) => received.push(payload);
    emitter.on("notification", listener);

    try {
      await startNotificationBus("");
      publishNotification("local-only");
    } finally {
      emitter.off("notification", listener);
    }

    expect(global.notificationBus).toBeUndefined();
    expect(received).toEqual(["local-only"]);
  });
});
