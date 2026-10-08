# A Booking's Planned Period Is Frozen Once It Starts

`Booking` carries two date pairs and they are not interchangeable:

| Pair                        | Meaning                | Who writes it                                  |
| --------------------------- | ---------------------- | ---------------------------------------------- |
| `originalFrom`/`originalTo` | the **planned** period | create, DRAFT edit, reserve — and nothing else |
| `from`/`to`                 | the **live** period    | extension, check-out/check-in date rewrites    |

Once a booking starts, only `from`/`to` move. Booking Compliance measures
returns against the planned end, so writing `originalTo` on a started booking
erases the deadline the custodian agreed to — and makes the metric resettable
by the person it measures (extend a late booking, it scores on-time).

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
