/**
 * Local notification emitter
 *
 * A process-wide EventEmitter that fans toast payloads out to the SSE streams
 * open on THIS machine. Payloads arrive from the notification bus (which
 * re-emits what every machine publishes through Postgres LISTEN/NOTIFY) or
 * directly from `publishNotification` when the bus is unavailable. The SSE
 * route subscribes to the "notification" event and forwards matching payloads
 * to the browser.
 *
 * The instance lives on `global` so dev hot reloads keep a single emitter.
 *
 * @see {@link file://./notification-bus.server.ts}
 * @see {@link file://./../../routes/api+/sse.notification.ts}
 */
import { EventEmitter } from "node:events";

declare global {
  var emitter: EventEmitter;
}

if (!global.emitter) {
  global.emitter = new EventEmitter();
}

export const emitter = global.emitter;
