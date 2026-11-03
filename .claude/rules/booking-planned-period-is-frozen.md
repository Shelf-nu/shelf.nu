---
description: originalFrom/originalTo are the planned period and are never overwritten once a booking starts; readers pick planned or live and stay on it
paths:
  - "apps/webapp/app/modules/booking/**"
  - "apps/webapp/app/modules/reports/**"
  - "apps/webapp/app/routes/**/*booking*"
  - "apps/webapp/app/components/booking/**"
  - "apps/webapp/app/utils/csv.server.ts"
---

# A Booking's Planned Period Is Frozen Once It Starts

`Booking` carries two date pairs and they are not interchangeable:

| Pair                        | Meaning                | Who writes it                                   |
| --------------------------- | ---------------------- | ----------------------------------------------- |
| `originalFrom`/`originalTo` | the **planned** period | create, DRAFT edit, reserve, expired reschedule |
| `from`/`to`                 | the **live** period    | extension, check-out/check-in date rewrites     |

Once a booking starts, only `from`/`to` move. Booking Compliance measures
returns against the planned end, so writing `originalTo` on a started booking
erases the deadline the custodian agreed to — and makes the metric resettable
by the person it measures (extend a late booking, it scores on-time).

**One exception, and it is not a started booking.** Checking out an expired
reservation (RESERVED, end passed, never checked out) "with a new end date"
moves both pairs to the new window (`applyRescheduledWindow`). Nothing went
out against the old plan, so it was never a deadline anyone missed: the
operator and custodian are agreeing to a new reservation at the counter. The
replaced period goes on the activity trail as a note and
`BOOKING_DATES_CHANGED` events. It is reachable only from the header's full
check-out, never from a scan or a batch.

Flows that rewrite `from`/`to` must **seed, never overwrite**. Use
`plannedStartToPreserve` / `plannedEndToPreserve` (`~/modules/booking/service.server`),
which return `undefined` — Prisma's "leave unchanged" — on any row that already
has the column, and only fill in rows created before it existed.

```ts
// ❌ Bad — an extended booking loses the deadline it agreed to
dataToUpdate.originalTo = bookingFound.to;

// ✅ Good — seeds legacy rows, leaves a real plan alone
dataToUpdate.originalTo = plannedEndToPreserve(bookingFound);
```

**Readers pick a side and stay on it.** `resolvePlannedEnd` /
`resolvePlannedStart` (`~/modules/booking/lateness`) answer "what was agreed" —
compliance reporting, "scheduled" columns, period membership. Raw `to` answers
"what is true now" — the overdue badge, Overdue Items. `getLatenessMs` takes a
resolved `scheduledEnd` precisely so each call site states which it means.
Mixing them within one surface puts a row in one period and labels it with
another.

Neither the compiler nor a test can catch a wrong choice here: both dates are
real, and every number still renders. When you touch one of these flows, grep
the siblings — `checkoutBooking`, `fulfilModelRequestsAndCheckout`,
`checkinBooking`, `partialCheckinBooking`, `partialCheckoutBooking`,
`extendBooking`.
