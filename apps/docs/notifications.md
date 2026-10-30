# Toast Notifications

Toasts ("Assets updated", "Custody assigned") are sent from server actions and
shown in the browser of the user who triggered them.

## How a toast travels

1. An action calls `sendNotification(...)`.
2. `sendNotification` serializes the toast and calls `pg_notify` on the Postgres
   channel `shelf_notification`.
3. Every webapp server holds one `LISTEN shelf_notification` connection and
   receives the payload, the sender included.
4. Each server re-emits the payload on its local in-process emitter.
5. The browser's `/api/sse/notification` stream, open on one of the servers,
   forwards the payload if the logged-in user is the `senderId` and, for
   tab-scoped toasts, the stream belongs to the originating tab.

The request that ran the action and the browser's SSE stream can be on
different machines, which is why the toast goes through Postgres instead of
staying in memory.

## Requirements

The listener connects with `DIRECT_URL`. LISTEN needs a session that stays
open, and the transaction pooler (`DATABASE_URL`) hands each statement to a
different backend and silently drops the subscription.

## Fallback

If `DIRECT_URL` is unset, or the listener connection is down (it retries with
a growing delay), toasts are emitted on the machine that ran the action. They
still reach browsers streaming from that same machine, but not from others.
Oversized payloads (about 8 KB or more) take the same local path.

## Verifying on a multi-machine deploy

Run a bulk action (for example bulk update of a custom field) several times.
Every run should show its toast. A missing toast on some runs points at a
machine without a working listener: check its logs for `Notification` errors
and confirm `DIRECT_URL` is set.
