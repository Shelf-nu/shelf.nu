/**
 * Notification bus
 *
 * Fans toast notifications out across every machine that runs the webapp.
 * `/api/sse/notification` streams from the in-process `emitter`, so a toast
 * emitted on one machine reaches only the browsers streaming from that same
 * machine. The bus closes that gap with Postgres LISTEN/NOTIFY: each machine
 * holds one dedicated connection that LISTENs on {@link NOTIFICATION_CHANNEL},
 * a publish is a `pg_notify` on that channel, and every listening machine
 * (the publisher included) re-emits the payload on its own `emitter`.
 *
 * Whenever the bus cannot deliver through Postgres (not connected yet, the
 * connection dropped, the payload is over the NOTIFY size limit, or the
 * `pg_notify` call fails) the payload is emitted locally instead, so a toast
 * still reaches browsers on the publishing machine. Lost connections are
 * retried with a capped backoff, and `start()` never rejects, so a database
 * outage cannot stop the server from booting. While a machine's listener is
 * down, toasts published on other machines do not reach its browsers.
 *
 * The connection uses `DIRECT_URL` because LISTEN needs a session that stays
 * open: a transaction-mode pooler hands each statement to a different backend
 * and silently drops the subscription.
 *
 * @see {@link file://./emitter.server.ts} the in-process emitter
 * @see {@link file://./send-notification.server.ts} where toasts are sent
 * @see {@link file://../scheduler-error.ts} connection-secret scrubbing
 */
import pg, { type Client, type ClientConfig, type Notification } from "pg";
import { emitter } from "./emitter.server";
import { DIRECT_URL } from "../env";
import { ShelfError, type AdditionalData } from "../error";
import { Logger } from "../logger";
import {
  connectionSecretsFrom,
  toSchedulerErrorCause,
} from "../scheduler-error";

/** The Postgres channel every machine LISTENs on */
export const NOTIFICATION_CHANNEL = "shelf_notification";

/**
 * Largest payload, in UTF-8 bytes, that is sent through `pg_notify`. Postgres
 * rejects NOTIFY payloads of 8000 bytes or more; the margin keeps the check
 * safely under that limit.
 */
export const MAX_NOTIFY_PAYLOAD_BYTES = 7900;

/** Delays between reconnect attempts; the last one repeats until it succeeds */
const DEFAULT_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

/**
 * How long a connection must stay up before the backoff starts again from the
 * shortest delay, so a connection that drops right after LISTEN backs off
 * instead of retrying every second.
 */
const STABLE_CONNECTION_MS = 30000;

/** Matches a Postgres connection string inside free-form error text */
const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"'<>]+/g;

/** Nested causes searched for connection strings, matching scheduler-error */
const MAX_CAUSE_DEPTH = 3;

/** The subset of pg.Client the bus uses; lets tests pass a fake. */
export type BusClient = Pick<Client, "connect" | "query" | "on" | "end">;

/** What the bus needs from the outside world, injected so tests can fake it */
export type NotificationBusDeps = {
  /** Builds a fresh, unconnected client; called once per (re)connect */
  createClient: () => BusClient;
  /** Re-emits a payload on this machine's emitter */
  emitLocal: (payload: string) => void;
  /** Receives every failure the bus recovers from, except repeated drops */
  logError: (error: ShelfError) => void;
  /**
   * Receives connection failures after the first one of a streak, so an outage
   * reports one error instead of one per retry; defaults to `logError`
   */
  logWarning?: (error: ShelfError) => void;
  /** Delays between reconnect attempts; defaults to 1s, 2s, 5s, 10s, 30s */
  reconnectDelaysMs?: number[];
  /**
   * Connection values (user, password, host) to redact from logged errors, as
   * returned by `connectionSecretsFrom`. Credentials of any connection string
   * that appears in an error's text are redacted regardless.
   */
  connectionSecrets?: readonly string[];
};

/** A cross-machine publisher for toast payloads */
export type NotificationBus = {
  /** Connects and LISTENs; never rejects, schedules a retry instead */
  start(): Promise<void>;
  /** Sends a payload to every machine; synchronous and fire-and-forget */
  publish(payload: string): void;
  /** Whether the LISTEN connection is currently up */
  isListening(): boolean;
  /** Cancels pending retries and ends the client (tests and shutdown) */
  stop(): Promise<void>;
};

/**
 * Collects the credentials of every connection string found in an error's
 * message and stack, and those of its nested causes.
 *
 * @param cause - Whatever the pg client rejected with or emitted
 * @param depth - Nesting level of this cause; callers omit it
 * @returns User, password and host values to redact
 */
function secretsInErrorText(cause: unknown, depth = 0): string[] {
  if (typeof cause === "string") {
    return (cause.match(CONNECTION_STRING_PATTERN) ?? []).flatMap(
      connectionSecretsFrom
    );
  }
  if (!cause || typeof cause !== "object" || depth > MAX_CAUSE_DEPTH) {
    return [];
  }
  const source = cause as Record<string, unknown>;
  return [
    ...secretsInErrorText(source.message, depth),
    ...secretsInErrorText(source.stack, depth),
    ...secretsInErrorText(source.cause, depth + 1),
  ];
}

/**
 * Client settings for the LISTEN connection. The connection sits idle between
 * notifications, so TCP keepalive stops load balancers and NAT from silently
 * dropping it, and the timeouts make a dead socket fail into the local
 * fallback instead of hanging.
 *
 * @param connectionString - Direct (non-pooled) Postgres URL
 * @returns Options for `new pg.Client`
 */
export function listenerClientConfig(connectionString: string): ClientConfig {
  return {
    connectionString,
    keepAlive: true,
    keepAliveInitialDelayMillis: 30000,
    connectionTimeoutMillis: 10000,
    query_timeout: 5000,
  };
}

/**
 * Creates a notification bus. The bus is idle until `start()` is called, and
 * publishes locally until its LISTEN connection is up.
 *
 * @param deps - Client factory, local emitter, error sink and retry delays
 * @returns The bus
 */
export function createNotificationBus(
  deps: NotificationBusDeps
): NotificationBus {
  const delays =
    deps.reconnectDelaysMs && deps.reconnectDelaysMs.length > 0
      ? deps.reconnectDelaysMs
      : DEFAULT_RECONNECT_DELAYS_MS;

  /** The current client, connecting or connected; null while idle */
  let client: BusClient | null = null;
  /** True only once LISTEN has succeeded on `client` */
  let listening = false;
  /** Consecutive failed attempts, indexes into `delays` */
  let failedAttempts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Resets `failedAttempts` once a connection has stayed up long enough */
  let stableTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set by stop() so an in-flight connect does not resurrect the bus */
  let stopped = false;

  /** Wraps a recovered failure in a ShelfError with its secrets scrubbed */
  function logFailure(
    message: string,
    cause: unknown,
    additionalData?: AdditionalData,
    log: (error: ShelfError) => void = deps.logError
  ) {
    const secrets = [
      ...(deps.connectionSecrets ?? []),
      ...secretsInErrorText(cause),
    ].sort((a, b) => b.length - a.length);
    log(
      new ShelfError({
        // The raw cause can carry the pg client and its connection parameters
        cause: toSchedulerErrorCause(cause, secrets),
        message,
        additionalData,
        label: "Notification",
      })
    );
  }

  /**
   * Re-emits a payload on this machine. A throwing SSE listener must not
   * escape: inside pg's socket handler it would crash the process.
   */
  function emitLocal(payload: string) {
    try {
      deps.emitLocal(payload);
    } catch (cause) {
      logFailure("Failed to deliver notification on this server", cause);
    }
  }

  function clearStableTimer() {
    if (stableTimer) {
      clearTimeout(stableTimer);
      stableTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped || retryTimer) return;
    const delay = delays[Math.min(failedAttempts, delays.length - 1)];
    failedAttempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, delay);
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    let next: BusClient;
    try {
      next = deps.createClient();
    } catch (cause) {
      // A client that cannot be built (a malformed URL) fails the same way on
      // every retry, so none is scheduled
      logFailure("Notification bus could not be created", cause);
      return;
    }
    client = next;
    /**
     * A dead client can report its failure more than once (a rejected connect
     * plus an `error` event, or an `error` followed by `end`), and ending it
     * emits `end` again. Only the first report counts.
     */
    let dropped = false;

    const drop = (message: string, cause: unknown) => {
      if (dropped || client !== next) return;
      dropped = true;
      listening = false;
      client = null;
      clearStableTimer();
      // Only the first failure of a streak is an error; retries are warnings
      logFailure(
        message,
        cause,
        undefined,
        failedAttempts === 0 ? deps.logError : deps.logWarning ?? deps.logError
      );
      // Ending a client that is already dead can reject; nothing is left to do
      next.end().catch(() => {});
      scheduleReconnect();
    };

    next.on("notification", (message: Notification) => {
      if (message.channel !== NOTIFICATION_CHANNEL || !message.payload) return;
      emitLocal(message.payload);
    });
    // Listening for `error` also keeps an unhandled error event from crashing
    // the process
    next.on("error", (cause: Error) => {
      drop("Notification bus connection failed", cause);
    });
    next.on("end", () => {
      drop("Notification bus connection ended", undefined);
    });

    try {
      await next.connect();
      await next.query(`LISTEN ${NOTIFICATION_CHANNEL}`);
    } catch (cause) {
      drop("Notification bus could not connect", cause);
      return;
    }

    // stop() or a drop happened while connecting; this client is no longer ours
    if (dropped || client !== next) return;
    listening = true;
    if (failedAttempts > 0) {
      stableTimer = setTimeout(() => {
        stableTimer = null;
        failedAttempts = 0;
      }, STABLE_CONNECTION_MS);
    }
  }

  return {
    async start() {
      stopped = false;
      // Already connecting, connected or waiting to retry
      if (client || retryTimer) return;
      await connect();
    },

    publish(payload) {
      const bytes = Buffer.byteLength(payload, "utf8");
      if (bytes > MAX_NOTIFY_PAYLOAD_BYTES) {
        emitLocal(payload);
        logFailure("Notification payload is too large to publish", null, {
          bytes,
          maxBytes: MAX_NOTIFY_PAYLOAD_BYTES,
        });
        return;
      }

      const current = client;
      if (!listening || !current) {
        emitLocal(payload);
        return;
      }

      // Postgres delivers a session's own notification before the query
      // completes, so on success the payload has already come back through
      // LISTEN here. If the connection dies first the query rejects and the
      // payload is emitted locally: at worst a duplicate toast, never a lost one
      current
        .query("SELECT pg_notify($1, $2)", [NOTIFICATION_CHANNEL, payload])
        .catch((cause: unknown) => {
          emitLocal(payload);
          logFailure("Failed to publish notification", cause);
        });
    },

    isListening() {
      return listening;
    },

    async stop() {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      clearStableTimer();
      listening = false;
      const current = client;
      client = null;
      if (current) {
        await current.end().catch(() => {});
      }
    },
  };
}

declare global {
  var notificationBus: NotificationBus | undefined;
}

/**
 * Starts the process-wide bus on `global.notificationBus`, built from
 * `DIRECT_URL` and the real emitter. Idempotent: the global survives dev hot
 * reloads, and a second call on a started bus does nothing.
 *
 * Without a direct connection string no bus is created and toasts stay on
 * this machine, because a pooled connection cannot hold a LISTEN session.
 *
 * @param connectionString - Direct (non-pooled) Postgres URL; defaults to `DIRECT_URL`
 * @returns Resolves once the first connect attempt has finished; never rejects
 */
export async function startNotificationBus(
  connectionString: string | undefined = DIRECT_URL
): Promise<void> {
  if (!connectionString) {
    Logger.info(
      "DIRECT_URL is not set: toast notifications reach browsers on this server only."
    );
    return;
  }
  if (!global.notificationBus) {
    global.notificationBus = createNotificationBus({
      createClient: () => new pg.Client(listenerClientConfig(connectionString)),
      emitLocal: (payload) => {
        emitter.emit("notification", payload);
      },
      logError: (error) => Logger.error(error),
      logWarning: (error) => Logger.warn(error),
      connectionSecrets: connectionSecretsFrom(connectionString),
    });
  }
  await global.notificationBus.start();
}

/**
 * Publishes a toast payload through the process bus when it exists, else emits
 * it on this machine's emitter.
 *
 * @param payload - The serialized notification
 */
export function publishNotification(payload: string): void {
  if (global.notificationBus) {
    global.notificationBus.publish(payload);
    return;
  }
  emitter.emit("notification", payload);
}
