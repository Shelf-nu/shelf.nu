# Shelf Companion 1.8.0: store release notes

Paste **one section**: the App Store text into App Store Connect (4000
characters allowed), the Google Play text into Play (500). The last section is
internal and must not reach a store listing.

Items marked **(pending)** are open PRs. Keep a line only if its PR is an
ancestor of the build commit (see STORE-RELEASE.md, step 2); delete it otherwise.

---

## App Store: What's New

Made for bigger and folding screens, and quicker at the desk.

- iPhone Duo: Shelf now fills the whole open screen, with the tabs as a sidebar
  when you hold it sideways
- Foldable phones and wide windows: buttons, lists and the scanner stay clear
  of the screen edges and the camera cutout
- Descriptions: the box grows as you type, so you can read and edit a long
  description without scrolling a three-line window
- Bookings: Check In All and Check Out come first on a booking, right under the
  progress bar (pending)
- Scanner: the flashlight stays on for the whole batch, and the Enter code,
  pause and flashlight buttons can no longer be covered by the list of scanned
  items, which you can now fold away (pending)
- Links: links in notes, descriptions and custom fields are tappable. Websites
  and files open inside Shelf, and links to a Shelf asset, kit or booking open
  that screen in the app (pending)

Shelf Companion now needs iOS 16.4 or later.

---

## Google Play: What's New (under 500 characters)

Better on foldable phones and wide screens: buttons, lists and the scanner stay
clear of the edges. Description boxes grow as you type. Check in and check out
come first on a booking (pending). The scanner's flashlight stays on for the
whole batch, and its buttons are never covered (pending). Links in notes and
descriptions are tappable and open inside Shelf (pending).

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

- [ ] **Cold-start quick action:** with the app fully closed, long-press the
      icon and pick Scan. The scanner opens, not Home. Repeat with the app in
      the background. (iOS; Android too if shortcuts show there.)
- [ ] **Deep links:** `shelf://` links to an asset, a kit and a booking open the
      right screen, with the app closed and with it in the background.
- [ ] **Universal links / app links:** an `app.shelf.nu` asset, kit and booking
      URL tapped in Mail or Notes opens the app on that screen, from a cold
      start too.
- [ ] **Android compile:** a clean Android build of the release commit
      succeeds (not checked since the SDK 58 upgrade commit).
- [ ] **iOS release archive:** the production build archives, installs and
      launches. Check the scan sound, camera, push registration and sign-in.
- [ ] **Android release build with R8:** the production AAB installs (bundletool
      universal APK) and launches. Check scanning, the scan sound and push.
      R8 strips anything a missing keep rule should have protected, so open
      every tab.
