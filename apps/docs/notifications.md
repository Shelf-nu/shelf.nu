# Toast Notifications

Toasts ("Assets updated", "Custody assigned", error messages from failed
actions) are sent from server actions and shown in the browser of the user who
triggered them. This page explains how they travel, what a deployment needs
for them to work, and how to check that they do.

**TL;DR for self-hosters:** there is no new setting. Toasts use the
`DIRECT_URL` you already set for migrations. If you run more than one webapp
instance, make sure `DIRECT_URL` is available to the running server (not only
to the migration step) and that it is a session-mode connection.

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

The browser keeps a long-lived Server-Sent Events (SSE) stream open to one
server. The request that runs an action can land on any other server behind
the load balancer. Postgres is the one thing every server shares, so the toast
goes through it instead of staying in the memory of the server that ran the
action.

No table, extension or migration is involved. `LISTEN` and `NOTIFY` are
built into Postgres and any database role may use them.

## What your deployment needs

### `DIRECT_URL` at runtime

The listener connects with `DIRECT_URL`. Most setups already pass it to the
server, because the Docker image runs `prisma migrate deploy` with it on
startup (see [Docker Setup](./docker.md)). If you run migrations from a
separate job and give the server only `DATABASE_URL`, add `DIRECT_URL` to the
server's environment too.

### A session-mode connection

`LISTEN` only works on a connection that stays bound to one Postgres session
for its whole life.

| Connection                                               | Works for toasts |
| -------------------------------------------------------- | ---------------- |
| Supabase direct connection (`db.<ref>.supabase.co:5432`) | Yes              |
| Supabase session pooler (`pooler.supabase.com:5432`)     | Yes              |
| Supabase transaction pooler (`pooler.supabase.com:6543`) | No               |
| Self-hosted Postgres, direct                             | Yes              |
| PgBouncer in `session` pool mode                         | Yes              |
| PgBouncer in `transaction` pool mode                     | No               |

A transaction pooler hands each statement to whichever backend is free, so the
subscription is silently lost. That is why `DATABASE_URL` (the transaction
pooler on Supabase) is not used.

The Supabase direct connection is IPv6 only unless your project has the IPv4
add-on. If your host has no IPv6, use the session pooler string for
`DIRECT_URL` instead. It works for both migrations and toasts.

### One extra connection per server

Each running webapp server opens one extra, mostly idle connection. Five
instances means five more connections on `DIRECT_URL`. Account for this if
your database plan has a low connection limit.

## Single instance and fallback

If `DIRECT_URL` is unset, the server logs this once at startup and toasts are
emitted in memory on the machine that ran the action:

```
DIRECT_URL is not set: toast notifications reach browsers on this server only.
```

On a single-instance deployment that is all you need: every request and every
SSE stream land on the same machine, so toasts still arrive. On several
instances, toasts only arrive when the action and the browser's stream happen
to hit the same machine.

The same in-memory path is used while the listener connection is down (it
reconnects after 1, 2, 5, 10 and then every 30 seconds) and for oversized
payloads (about 8 KB or more). A database outage never makes an action fail
because of a toast.

## Verifying a deployment

Run a bulk action (for example bulk update of a custom field) five or more
times. Every run should show its toast. A toast missing on some runs points at
a server without a working listener: check its logs for errors labelled
`Notification`, and confirm `DIRECT_URL` is set on that server and is not a
transaction pooler URL.

## Testing locally

The unit tests use a fake client and run with the rest of the suite. A second
test file talks to a real Postgres, publishes on one bus and checks that a
second bus (standing in for another server) receives it. It creates no tables
and is skipped unless you point it at a database:

```bash
cd apps/webapp
NOTIFICATION_BUS_TEST_DATABASE_URL="<your DIRECT_URL>" \
  pnpm exec vitest --run app/utils/emitter/notification-bus.db.test.ts
```

CI does not set this variable, so the file is skipped there.

## Code map

- `apps/webapp/app/utils/emitter/send-notification.server.ts`: the
  `sendNotification()` entry point actions call
- `apps/webapp/app/utils/emitter/notification-bus.server.ts`: the listener,
  publish, reconnect and fallback logic
- `apps/webapp/app/routes/api+/sse.notification.ts`: the SSE stream that
  filters by user and tab
- `apps/webapp/app/entry.server.tsx`: starts the bus once per server
