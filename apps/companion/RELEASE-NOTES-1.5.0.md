# Shelf Companion 1.5.0 — store release notes

Paste **one section**: the App Store text into App Store Connect (4000
characters allowed), the Google Play text into Play (500). The last section is
internal and must not reach a store listing.

---

## App Store — What's New

Connect the app to your own Shelf server.

- Tap "Connect to a private server" on the sign-in screen and enter your
  organisation's domain
- Sign in with your password or your company's single sign-on, against your own
  server
- Switch back to Shelf Cloud whenever you like, from the sign-in screen or from
  Settings

The scanner tells you what actually happened.

- Scan a code that belongs to another of your workspaces and the app names that
  workspace and offers to switch and open it, in one tap
- Scanning something already in your list is shown as a repeat, not an error
- Scanning a kit while fulfilling a reservation explains that reservations match
  individual assets, instead of appearing to succeed

Audits.

- Undo a scan: open a scanned row and remove it, and the asset goes back to
  where it was so you can scan it again
- Scanned rows show where the asset lives instead of repeating "Found"
- A count of assets that should not be there, which you can tap to see just
  those
- Notes and photos are counted separately on each row
- Archived audits are reachable, and "All" now includes them

Bookings.

- In a personal workspace the Bookings tab explains that bookings live in team
  workspaces, and offers to switch
- Days that have already passed no longer offer a new booking
- A new booking opens with a start time you can actually save
- Archive is available on reserved bookings that are past their end date, the
  same as on the web

Fixes.

- The app opens in the workspace you last chose on that device
- Delete Account opens the right page
- Amount custom fields show their currency
- Creating another asset no longer claims it will link a QR code it will not

---

## Google Play — What's New (under 500 characters)

Connect the app to your own Shelf server: enter your organisation's domain and
sign in with a password or single sign-on.

Scanner: a code from another of your workspaces now offers to switch and open
it. Repeat scans read as repeats, not errors.

Audits: undo a scan, see where each asset lives, and reach archived audits.

Bookings: clearer personal workspace, no bookings on past days, and a start
time that saves.

---

## Not for the stores — worth knowing internally

**Everyone's remembered workspace resets once.** The app stores that choice
under a new key, so the first launch of 1.5.0 falls back to the server's answer
before the device's own preference takes over again. A person with several
workspaces may open the app somewhere they did not expect, once.

**Private-server access is gated by the registry, not the app.** A domain only
resolves if Shelf has registered it, and only over HTTPS. Adding a customer is
a server-side change and needs no new build.

**One line here was already announced in 1.4.0 and never shipped.** The notes
and photos count on audit scan rows was in the 1.4.0 store text, but the change
landed two days before that build was cut and was not an ancestor of it. It
ships for real now, so it belongs in these notes even though it reads as a
repeat.

**Two behaviours changed that people were trained on.** "Found" no longer
appears on scanned audit rows (the location is there instead), and the audits
"All" filter now returns archived audits, so existing lists get longer.
