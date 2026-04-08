# Maestro E2E Testing — Lessons Learned

A living document tracking observations, failures, and improvement opportunities across test runs.

## Known Limitations

- **Camera**: iOS Simulator has no physical camera. QR scanning is tested via deep links (`shelf://qr/{id}`) which exercise the same code path as real scans.
- **Haptics**: `expo-haptics` triggers are invisible to Maestro. Haptic feedback cannot be verified in E2E tests.
- **Network Toggle**: Simulator cannot easily toggle airplane mode. Offline-mode testing requires manual setup.
- **Biometrics**: Face ID / Touch ID enrollment on simulator requires separate `xcrun simctl` commands.
- **Push Notifications**: Remote push notifications cannot be tested on simulator without APNs setup.

## Test User Requirements

- Dedicated test account with known credentials
- At least one asset with a known ID (for detail/edit tests)
- At least one booking with a known ID (for detail tests)
- At least one QR code linked to an asset (for deep link scan tests)
- At least one active audit (for audit flow tests)
- Multi-org access (optional, for workspace switching tests)

## Test Data IDs

Fill in `env/test.env` with real IDs from your test organization. The IDs must reference entities that:

- Belong to the test user's active organization
- Are in the expected status for the test (e.g., RESERVED booking for checkout)

## Critical Patterns Discovered

### 1. Stale Accessibility Tree After `runFlow` (iOS)

**Problem**: After `runFlow` returns, Maestro's accessibility tree cache is stale on iOS. Commands like `extendedWaitUntil: visible:` and `assertVisible:` fail to find elements that ARE on screen.

**Fix**: Always use `tapOn` on a known element immediately after `runFlow` — `tapOn` has built-in retry that forces the a11y tree to refresh. Established pattern:

```yaml
- runFlow: ../../shared/login.yaml
- tapOn:
    text: "Quick Actions" # Forces a11y tree refresh
```

### 2. `clearKeychain` Required for Suite Runs

**Problem**: `clearState` only clears AsyncStorage/app data, NOT the iOS Keychain. After a test logs in, the auth token persists in SecureStore (Keychain). Subsequent tests see auto-login and skip the login screen.

**Fix**: Add `clearKeychain` in the shared login flow:

```yaml
- clearState
- clearKeychain
- launchApp
```

### 3. Deep Link Alert Dialog After `clearKeychain`

**Problem**: After `clearKeychain` + `launchApp`, the Expo dev client may show an "Open in Shelf?" dialog from a pending deep link. This blocks the dev server URL assertion.

**Fix**: Dismiss the dialog as an optional step before asserting:

```yaml
- tapOn:
    text: "Cancel"
    optional: true
```

### 4. Filter Pill Accessibility Labels

**Problem**: Filter pills use formatted a11y labels like `"Filter: All"` and `"Filter: Available"` — NOT just "All" or "Available". Selected state is conveyed via `accessibilityState`, not in the label text.

**Fix**: Use the full a11y label pattern:

```yaml
- tapOn: "Filter: All.*" # Regex to match the label
- assertVisible: "Filter: Available"
```

### 5. Theme Button Accessibility Labels

**Problem**: Theme options use `"Theme: Dark"`, `"Theme: Light"`, `"Theme: System, selected"` — NOT just "Dark", "Light", "System".

### 6. Sign Out Button Accessibility Label

**Problem**: The Sign Out button's a11y label is `"Sign out of your account"` — NOT "Sign Out".

### 7. `hideKeyboard` Unreliable on Search Bars

**Problem**: `hideKeyboard` fails with "custom input" error on some TextInput components (search bars). The keyboard can't be dismissed via the standard iOS dismiss action.

**Fix**: Use `- back` to dismiss the keyboard, or tap another non-keyboard element (like a filter pill).

### 8. `timeout` Not Valid on `tapOn`

**Problem**: The `timeout` property is NOT valid on `tapOn` in Maestro 2.3.0. It's only valid on `extendedWaitUntil` and `scrollUntilVisible`.

**Fix**: Use `optional: true` for non-critical taps (default retry ~5s). For longer waits, use `extendedWaitUntil` before the `tapOn`.

### 9. `scroll` Has No `direction` Property

**Problem**: `scroll:` with `direction: DOWN` is invalid. The `scroll` command has no properties.

**Fix**: Use bare `- scroll` (defaults to scrolling down).

### 10. Horizontal Filter Pill Scrolling

**Problem**: Filter pills are in a horizontal ScrollView. Tapping pills on the right (e.g., "In Custody") scrolls "All" off-screen, making it unfindable.

**Fix**: Test filters near the beginning of the list, or reset to "All" before tapping distant filters.

## Run History

### 2026-03-11 — Initial Full Suite Run

**Environment**: iPhone 15 Pro Max (iOS 17.5), Maestro 2.3.0, Expo Dev Client
**User**: nbonev@duck.com (Personal workspace, 0 assets)

| Suite     | Flows  | Result           |
| --------- | ------ | ---------------- |
| Auth      | 3      | 3/3 PASSED       |
| Dashboard | 4      | 4/4 PASSED       |
| Assets    | 6      | 6/6 PASSED       |
| Scanner   | 3      | 3/3 PASSED       |
| Bookings  | 5      | 5/5 PASSED       |
| Audits    | 3      | 3/3 PASSED       |
| Settings  | 3      | 3/3 PASSED       |
| Dark Mode | 3      | 3/3 PASSED       |
| **Total** | **30** | **30/30 PASSED** |

**Observations**:

- All 30 flows pass when run per-suite
- `clearKeychain` is essential for suite runs (prevents auto-login)
- Deep link "Cancel" dialog appears after `clearKeychain` — handled
- Filter pill and theme button a11y labels differ from visual text
- Empty workspace (0 assets) works fine — optional assertions handle it
- Each flow takes ~40-55s (login overhead: ~25s per flow)

<!-- Future entries appended below -->

---

## Run: 2026-04-02 12:57:08

**Result:** 25/31 passed (6 failed, 0 skipped)

**Failed:**

- `auth/02-login-validation`
- `auth/03-forgot-password`
- `assets/01-list-loads`
- `assets/02-search-filter`
- `assets/04-create-asset`
- `assets/06-pagination`

**Observations:**

- <!-- Add observations here -->

**Opportunities:**

- <!-- Add improvement ideas here -->

---

## Run: 2026-04-02 14:00:38

**Result:** 31/31 passed (0 failed, 0 skipped)

**Observations:**

- <!-- Add observations here -->

**Opportunities:**

- <!-- Add improvement ideas here -->

---

## Run: 2026-04-03 14:38:07

**Result:** 37/37 passed (0 failed, 0 skipped)

**Observations:**

- <!-- Add observations here -->

**Opportunities:**

- <!-- Add improvement ideas here -->
