# Working Hours Are Local To The Physical Location

Working hours describe when a **physical place** is open. Both halves are
absolute and location-local — never relative to whoever is looking:

| Part                               | Meaning                   | Never                                                  |
| ---------------------------------- | ------------------------- | ------------------------------------------------------ |
| `weeklySchedule` times (`"09:00"`) | wall-clock **on site**    | convert through a viewer's timezone                    |
| `WorkingHoursOverride.date`        | an absolute calendar date | format the stored UTC-midnight instant in a local zone |

"Open 9–5" means 9–5 where the assets physically are. It does not become 2–10
because the person reading it is in another country. The schema says so at
`packages/database/prisma/schema.prisma` on `WorkingHours.weeklySchedule`:
_"no timezone conversion … interpreted as local wall time, not UTC"_.

**The dates half is already enforced.** Use `getOverrideDateKey()`
(`~/modules/working-hours/utils`) to read an override's day — it reads from UTC,
because the DB column is `@db.Date` and Prisma hydrates it as UTC midnight.
Formatting that instant in a local zone shifts it a day west of UTC, which made
a "closed on the 24th" override match bookings on the 23rd.

```ts
// ❌ Bad — UTC-midnight instant read in the viewer's zone; off by one for America/*
const key = format(override.date, "yyyy-MM-dd");

// ✅ Good
const key = getOverrideDateKey(override.date);
```

**The times half is NOT enforced, deliberately.** `validateWorkingHours`
(`~/components/booking/forms/forms-schema`) and `getBookingDefaultStartEndTimes`
convert the booking instant into the **acting user's** preference zone before
comparing `HH:mm` against the window. Strictly that contradicts the rule: a user
in Tokyo booking an Amsterdam-located asset has Amsterdam's 9–5 judged against
Tokyo wall time.

This is an **accepted risk, decided 2026-08-20**: there is no
`Organization.timeZone` / `WorkingHours.timeZone` to evaluate against, and in
practice the people constrained by an org's working hours are at or near that
location. Fixing it properly means storing the location's zone (migration +
settings UI + backfill), which is not worth it for the ~0.1% case.

So: **do not "fix" this by threading more user-zone logic through working
hours, and do not file it as a bug.** If it ever does need solving, the answer
is a stored location zone, not a different user-side zone. The UI states the
semantics at the two places users meet them — the Weekly Schedule settings form
and the booking form's working-hours info box.

When you touch working-hours code, ask which half you are in: a **date** must
stay absolute (use the helper), a **time** is on-site wall clock and needs no
conversion at all. See [[quantity-semantics-per-surface]] for the same
"name what this value means before reaching for a helper" discipline.
