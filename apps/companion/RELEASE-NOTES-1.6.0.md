# Shelf Companion 1.6.0: store release notes

Paste **one section**: the App Store text into App Store Connect (4000
characters allowed), the Google Play text into Play (500). The last section is
internal and must not reach a store listing.

---

## App Store: What's New

Shelf now runs as a real iPad app.

- Screens fit the iPad instead of showing an enlarged iPhone app
- Turn the iPad sideways and the tabs move to a sidebar
- Works held upright or sideways

Bookings.

- Scan to check out a booking's assets
- Assets are grouped under their kits, and a kit can be picked as one unit
- See where each booked asset lives, and search your bookings
- Long booking descriptions open in full with "Show more"

Custody and stock.

- Scan quantity-tracked assets into and out of someone's custody
- Choose which location a pool's units come from
- Move part of a stock quantity to another location, and manage where it is kept

Audits.

- Tap a row to open the asset, then go back to the audit
- Long audit descriptions open in full with "Show more"

Roles and safety.

- Support for the new Manager role, which runs bookings, custody and audits
- Permanent deletes ask you to type the name first
- Archived assets show as archived

Fixes.

- The booking date pickers no longer crash on Android
- Sheets stay open until a save succeeds
- Asset descriptions show a character count, up to 5,000
- Opening a link to a booking or audit while another one is open shows the
  right one

---

## Google Play: What's New (under 500 characters)

Shelf now fits tablet screens, with a sidebar when the tablet is held sideways.

Bookings: scan to check out, kits grouped and picked as one unit, and search.

Custody: scan quantity-tracked assets in and out of custody.

Support for the new Manager role, and typed confirmation before permanent
deletes.

---

## Not for the stores: worth knowing internally

**Most of this already reached 1.5.0 phones over the air.** Only the tablet
layout (iPad app, Android tablet rotation) and the smaller Android download
need this build. Everything else shipped to 1.5.0 by OTA, the last one on
2026-10-15. The store text lists it anyway, because people installing fresh or
updating from 1.4.0 have never seen it.

**Over-the-air updates split by version after this.** 1.6.0 has its own runtime
version, so an OTA published for 1.6.0 does not reach 1.5.0 phones. Until most
people have updated, publish a fix once per live runtime version (see
EAS-UPDATE.md).

**App Store Connect needs 13-inch iPad screenshots** before it will send this
version to review. They carry over to later versions once uploaded.

**Android tablets.** The manifest stays portrait so phones never flash
sideways at launch; tablets unlock rotation at runtime. Android 16 already
ignores the portrait lock on large screens.
