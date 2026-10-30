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
import {
  createNotificationBus,
  NOTIFICATION_CHANNEL,
  type BusClient,
  type NotificationBus,
} from "./notification-bus.server";

const NOTIFY_SQL = "SELECT pg_notify($1, $2)";

/** Stands in for a pg.Client: real events, stubbed network calls */
class FakeClient extends EventEmitter {
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
  const createClient = vi.fn(() => {
    const client = new FakeClient();
    configure?.(client);
    clients.push(client);
    // The fake implements only the members the bus calls
    return client as unknown as BusClient;
  });
  const emitLocal = vi.fn<(payload: string) => void>();
  const logError = vi.fn<(error: ShelfError) => void>();
  const bus = createNotificationBus({ createClient, emitLocal, logError });
  buses.push(bus);
  return { bus, clients, createClient, emitLocal, logError };
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
    const { bus, createClient, logError } = setup((client) => {
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

    // Each failed attempt is logged once
    expect(logError).toHaveBeenCalledTimes(expectedDelays.length + 1);
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
