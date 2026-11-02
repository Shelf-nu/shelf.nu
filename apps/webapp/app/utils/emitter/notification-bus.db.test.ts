// @vitest-environment node
/**
 * Notification bus against a real Postgres.
 *
 * Two buses, each with its own connection and its own `emitLocal` spy, stand in
 * for two machines running the webapp. A payload published on one must reach
 * the spy of both: the other machine through LISTEN, and the publishing
 * machine through its own LISTEN (a publish is never emitted locally while the
 * bus is connected). A mocked client cannot show that Postgres really fans a
 * NOTIFY out to every session, or that a restarted bus subscribes again.
 *
 * Needs any reachable Postgres with a session-mode connection (LISTEN does not
 * work through a transaction-mode pooler). It creates no tables, so it is
 * skipped unless `NOTIFICATION_BUS_TEST_DATABASE_URL` is set:
 *
 *   NOTIFICATION_BUS_TEST_DATABASE_URL="<direct database url>" \
 *     pnpm webapp:test -- --run app/utils/emitter/notification-bus.db.test.ts
 *
 * @see {@link file://./notification-bus.server.ts}
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createNotificationBus,
  type NotificationBus,
} from "./notification-bus.server";
import type { ShelfError } from "../error";

const DATABASE_URL = process.env.NOTIFICATION_BUS_TEST_DATABASE_URL;

/** How long to wait for a NOTIFY to arrive before failing the test */
const DELIVERY_TIMEOUT_MS = 2000;

describe.skipIf(!DATABASE_URL)("notification bus (real database)", () => {
  /** Every error either bus recovered from; the tests expect none */
  const errors: ShelfError[] = [];
  const emittedOnA = vi.fn<(payload: string) => void>();
  let emittedOnB = vi.fn<(payload: string) => void>();
  let busA: NotificationBus;
  let busB: NotificationBus;

  /** Builds a bus that stands in for one machine */
  function createMachine(emitLocal: (payload: string) => void) {
    return createNotificationBus({
      createClient: () => new pg.Client({ connectionString: DATABASE_URL }),
      emitLocal,
      logError: (error) => errors.push(error),
    });
  }

  beforeAll(async () => {
    busA = createMachine(emittedOnA);
    busB = createMachine((payload) => emittedOnB(payload));
    await Promise.all([busA.start(), busB.start()]);
  });

  // Runs even when a test fails, so no connection outlives the suite
  afterAll(async () => {
    await Promise.all([busA?.stop(), busB?.stop()]);
  });

  it("a toast published on one machine reaches the other", async () => {
    expect(busA.isListening()).toBe(true);
    expect(busB.isListening()).toBe(true);

    const payload = '{"title":"x"}';
    busA.publish(payload);

    await vi.waitFor(
      () => {
        expect(emittedOnA).toHaveBeenCalledTimes(1);
        expect(emittedOnB).toHaveBeenCalledTimes(1);
      },
      { timeout: DELIVERY_TIMEOUT_MS }
    );

    expect(emittedOnA).toHaveBeenCalledWith(payload);
    expect(emittedOnB).toHaveBeenCalledWith(payload);
    expect(errors).toEqual([]);
  });

  it("a reconnected bus receives again", async () => {
    await busB.stop();
    // A fresh spy so the previous test's delivery is not counted
    emittedOnB = vi.fn<(payload: string) => void>();
    busB = createMachine((payload) => emittedOnB(payload));
    await busB.start();
    expect(busB.isListening()).toBe(true);

    const payload = '{"title":"y"}';
    busA.publish(payload);

    await vi.waitFor(
      () => {
        expect(emittedOnB).toHaveBeenCalledTimes(1);
      },
      { timeout: DELIVERY_TIMEOUT_MS }
    );

    expect(emittedOnB).toHaveBeenCalledWith(payload);
    expect(errors).toEqual([]);
  });
});
