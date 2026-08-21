# Shelf Companion 1.4.0 — store release notes

Paste as-is. App Store Connect allows 4000 characters; Google Play allows 500.

---

## App Store — What's New

Bookings now have a calendar.

- See the whole month at a glance, with a coloured band for every booking
- Tap any day to see what is booked, and create a booking on that day in one tap
- Switch between the list and the calendar from the header

Audits are easier to trust.

- Add photos and condition notes right on the row you just scanned
- Read them back later: open any audited asset to see its photos and notes in
  full, with who recorded them and when
- Notes and photos are counted separately, so a row with one note and one photo
  no longer reads as "2"
- Assets you have not reached yet are called "not scanned" instead of "missing",
  so a running audit no longer reads like an alarm
- Audit colours and wording now match the website exactly

Assets and bookings show more.

- Asset rows show the model and the asset ID
- Booking details show who created the booking and the tags on it
- Add notes to an asset from your phone

Fixes.

- Booking times follow your account's timezone and week start
- Booking dates on the home screen include the month again
- Reserve tells you why it is unavailable instead of doing nothing
- Every status badge now meets accessibility contrast standards, in light and
  dark mode

---

## Google Play — What's New (under 500 characters)

Bookings now have a calendar: see the month at a glance, tap a day to see what
is booked, and create a booking on that day.

Audits: add photos and condition notes while scanning, then read them back on
any audited asset. Clearer wording for assets you have not reached yet.

Assets show their model and asset ID. Booking details show who created the
booking and its tags.

Fixes: booking times follow your account timezone, dates show the month, and
status badges meet contrast standards.

---

## Not for the stores — worth knowing internally

This build stops requiring a signature on over-the-air updates, which is what
makes 1.4.0 the first version we can hot-fix without a store review. No
1.3.x install can ever receive an update, so those users stay on 1.3.0 until
they take this release from the store.
