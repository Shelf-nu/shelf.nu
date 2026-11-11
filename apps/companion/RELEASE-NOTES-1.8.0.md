# Shelf Companion 1.8.0: store release notes

Paste **one section**: the App Store text into App Store Connect (4000
characters allowed), the Google Play text into Play (500). The last section is
internal and must not reach a store listing.

Every line below is an ancestor of both 1.8.0 build commits: Android
`e49568afa` and iOS `c376ffcda` (checked with `git merge-base --is-ancestor`,
STORE-RELEASE.md step 2). The only changes between the two are the iOS
microphone and motion purpose strings (#3383, #3384), so both stores ship the
same features. Work
still in review when the builds were cut is left out and ships later.

---

## App Store: What's New

Made for bigger and folding screens, and quicker at the desk.

- iPhone Duo: Shelf now fills the whole open screen, with the tabs as a sidebar
  when you hold it sideways
- Foldable phones and wide windows: buttons, lists and the scanner stay clear
  of the screen edges and the camera cutout
- Descriptions: the box grows as you type, so you can read and edit a long
  description without scrolling a three-line window
- Scanner: the flashlight stays on for the whole batch, and the Enter code,
  pause and flashlight buttons can no longer be covered by the list of scanned
  items, which you can now fold away
- Links: links in notes, descriptions and custom fields are tappable. Websites
  and files open inside Shelf, and links to a Shelf asset, kit or booking open
  that screen in the app
- Audits: scanning an item counted in units asks how many you found, and the
  audit shows the count, such as "8 of 14 pcs"
- Audit photos: each photo shows how it was added and when it was taken, and a
  photo taken long before the audit is marked "Old photo"
- Bookings: members who cannot delete bookings can discard a draft they no
  longer need

Shelf Companion now needs iOS 16.4 or later.

---

## Google Play: What's New (under 500 characters)

Better on foldable phones and wide screens: buttons, lists and the scanner stay
clear of the edges. Description boxes grow as you type. The scanner's
flashlight stays on and its buttons are never covered. Links in notes and
descriptions open inside Shelf. Audits count units for items tracked by
quantity, and audit photos show when they were taken. Members can discard a
draft booking.

---

## Not for the stores: worth knowing internally

**New Expo SDK, new runtime.** 1.8.0 is built on Expo SDK 58 (React Native
0.88) against the iOS 27.1 SDK, on the EAS `sdk-58` image. `version` and
`runtimeVersion` are 1.8.0 in all six places (`check-version-sync.mjs`). An OTA
published from `main` now reaches only 1.8.0 phones. To fix 1.7.0 phones over the
air, publish from the 1.7.0 base described in EAS-UPDATE.md (the parent of the
SDK 58 upgrade), never from `main`.

**iOS minimum moves from 15.1 to 16.4.** iPhones that cannot run iOS 16.4
keep 1.7.0 and stop receiving updates. The App Store handles this on its own.

**iPhone Duo full screen is proven only in the simulator** (Xcode 27.2, Duo
simulator, open and closed). It has not been checked on a real Duo yet.

**Native changes a 1.7.0 phone never saw:** the UIKit scene lifecycle
(`SceneDelegate`), `expo-av` replaced by `expo-audio` for the scan sound, and
`expo-quick-actions` 6.0.1 with a patch, so a home-screen shortcut works from a
cold start.

### Device checks owed before submitting (from Nikolay's review of #3330)

Run these on the release build (or a production-profile build of the same
commit), and tick each one with the device and date:

- [x] **Cold-start quick action:** with the app fully closed, long-press the
      icon and pick Scan. The scanner opens, not Home. (iPhone Air, iOS 27.2,
      build 44, 2026-11-10: pass.) Not checked: app in the background,
      Android.
- [x] **Deep links:** `shelf://assets/<id>` with the app closed opens the
      asset. (iPhone Air, build 44, 2026-11-10: pass.) Not checked: kit and
      booking links, Android.
- [x] **Universal links / app links:** an `app.shelf.nu` asset link opens the
      asset with the app open, and so does `app.shelf.nu/qr/<id>` (where
      `eam.sh` labels redirect). With the app closed, build 44 opened Home;
      fixed by #3385 and shipped as an OTA on runtime 1.8.0 (update group
      `5bc3a497`). Retested on the iPhone after the OTA applied: the link
      tapped in Notes with the app closed opens the asset. (iPhone Air,
      2026-11-11: pass.) Not checked: kit and booking links, Android.
- [x] **Android compile:** a clean Android build of the release commit
      succeeds. (EAS production build of `e49568afa`, 2026-11-10.)
- [x] **iOS release archive:** build 44 installs from TestFlight, launches,
      signs in against production, and the camera scans with the flashlight
      staying on; description boxes grow. No Shelf crash reports on the
      device. (iPhone Air, 2026-11-10.) Not checked: scan sound, push
      registration.
- [x] **Android release build with R8:** the production AAB (versionCode 19)
      installs as a bundletool universal APK on an API 35 emulator and
      launches to sign-in; the private-server sheet and SSO open with no
      crash in logcat. All native libraries are 16 KB aligned. (2026-11-10.)
      Not checked: signed-in tabs, scanning, scan sound, push.
