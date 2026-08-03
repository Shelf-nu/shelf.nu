# Manual QA — User-level date/time formatting

Full manual test plan for the `feat/configurable-date-format` PR (#2654, reworked).
Feature: per-user **Date format**, **Time format (12/24h)**, **Start of week**, and
**Timezone**, honored across UI, exports, PDFs, emails, and date inputs.

Use the checkboxes to track a pass. **§0 is required setup.** For a fast pass, do
the ⭐ **Smoke test** (§1) + the 🐞 **Bug-fix regressions** (§9). For a full test,
work top to bottom.

**Reference values used throughout** (pick these when a test says "set to X"):

| Setting       | Value to test with                                           |
| ------------- | ------------------------------------------------------------ |
| Date format   | `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`                     |
| Time format   | `24-hour`, `12-hour`                                         |
| Start of week | `Monday`, `Sunday`, `Saturday`                               |
| Timezone      | `Europe/London`, `America/Los_Angeles` (−), `Asia/Tokyo` (+) |

**Reference instant:** a date around **22 June 2026, 14:05** is ideal — `22/06`
vs `06/22` makes the order obvious, and `14:05` vs `2:05 PM` makes 12/24h obvious.

---

## 0. Setup (required)

- [x] **Apply the migration locally.** The migration
      `20260715120000_add_user_datetime_prefs` was authored but NOT applied to the
      shared dev DB. Apply it (`pnpm db:deploy-migration`) or `pnpm db:reset` on your
      local DB before testing. Confirm the four new `User` columns exist
      (`dateFormat`, `timeFormat`, `weekStart`, `timeZone`).
- [x] **Start the app:** `pnpm webapp:dev` → http://localhost:3000.
- [x] Have at least **two user accounts** ready (an owner/admin + one more member
      in the same workspace) — needed for email recipient tests (§7).
- [x] Know how to override the **browser timezone** for detection tests: Chrome
      DevTools → ⋮ → More tools → **Sensors** → _Location_ → set a timezone override.
      (For display tests you can just pick the timezone in the settings card instead.)

---

## 1. ⭐ Smoke test (fast confidence pass)

- [x] Go to **Account → General** (`/account-details/general`). Confirm a
      **"Language & region"** card is present with 4 controls + a live
      **"Dates will look like…"** preview.
- [x] Set **Date format = DD/MM/YYYY**, **Time = 24-hour**, click **Update**.
      Preview updates; a success toast appears.
- [x] Open an **asset** with dates and a **booking** — dates now read day-first
      (e.g. `22/06/2026`) and times are 24-hour (`14:05`).
- [x] Change to **MM/DD/YYYY / 12-hour**, Update, reload. Same dates now read
      `06/22/2026` and `2:05 PM`.
- [x] Reload the page and navigate away/back — the preference **persists**.

If all five pass, the core wiring works. Continue for full coverage.

---

## 2. Settings card behavior

- [x] **Date format** dropdown lists exactly: `DD/MM/YYYY`, `MM/DD/YYYY`,
      `YYYY-MM-DD` — **no "Automatic"** option.
- [x] **Time format** lists `12-hour` and `24-hour`.
- [x] **Start of week** lists `Monday`, `Sunday`, `Saturday`.
- [x] **Timezone** is a **searchable** dropdown (type "Lon" → `Europe/London`
      appears). The search box is focusable on open.
- [x] The **live preview** ("Dates will look like: …") updates immediately as you
      change any control, _before_ saving, and matches the format you'd expect.
- [x] **Update** saves; a toast confirms; the values are still selected after reload.
- [x] Keyboard: open each dropdown with Enter/Space, arrow to an option, select
      with Enter. Focus rings are visible (a11y).
- [x] **Validation:** the form rejects a submission with an invalid timezone
      (shouldn't be reachable via the UI, but server-side validation exists).

---

## 3. Defaults: detection at signup + backfill for existing users

- [x] **New signup detection.** In DevTools, override timezone to **Asia/Tokyo**
      and use a browser/locale set to e.g. **en-GB**. Sign up a brand-new user (OTP
      flow). Open their **Language & region** card — it should be pre-populated with
      **DD/MM/YYYY**, **24-hour**, **Monday**, **Asia/Tokyo** (detected, not blank,
      no "Automatic").
- [x] Repeat with **en-US / America/Los_Angeles** → should detect **MM/DD/YYYY**,
      **12-hour**, **Sunday**, **America/Los_Angeles**.
- [x] **SSO / invite signups** (if available): a user created via SSO or by
      accepting an invite should likewise have detected prefs on first load.
- [x] **Existing-user backfill.** Take a user whose four columns are still `NULL`
      (created before this feature). Log in once. Their dates should render using
      browser-derived values immediately, and after that load their row should be
      populated (check the DB, or reopen the settings card — values are concrete).
      This should happen silently with no error and no visible delay.

---

## 4. Display surfaces (the sweep)

Set **DD/MM/YYYY + 24-hour** first, then re-verify a couple with **MM/DD/YYYY +
12-hour**. Every date below must reflect the chosen format (no US-format leaks).

**Assets**

- [x] Assets index — created/updated dates, custody dates.
- [x] Asset detail/overview — all date fields.
- [x] Asset **custom field of type DATE** — displays in your format (🐞 see §9).
- [x] Assets index **custom-field date column** (advanced mode).

**Bookings**

- [x] Bookings index — from/to dates.
- [x] Booking detail/overview — start, end, planned vs actual.
- [x] Booking asset rows, check-in/out timestamps.

**Kits / Locations**

- [x] Kit detail dates; Location page asset dates.

**Dashboard / Home**

- [ ] Home widgets: upcoming/active/overdue bookings, upcoming reminders — the
      compact `Jun 22` style dates. (Month names stay English; order/day reflect prefs.)

**Calendar**

- [ ] Calendar page + availability calendar — header title & day/week subtitles.
- [ ] **Start of week:** set **Monday** → the calendar grid starts on Monday.
      Set **Sunday** → starts Sunday. Set **Saturday** → starts Saturday.

**Reports**

- [ ] Report pages — hero metrics, timeframe label, table row dates, chart axis
      labels, the timeframe-picker footer range. (Axis month labels may stay short
      English — that's intentional.)

**Audits**

- [ ] Audit index + audit overview — created/due/completed timestamps.
- [ ] Audit receipt/notes dates.

**Other**

- [ ] **Command palette** (Cmd/Ctrl-K) — audit due date + booking date range in
      the result rows.
- [ ] **Notes/activity feeds** — timestamps.
- [ ] **Asset filter preset chips** — a saved date filter shows the date value in
      your format (🐞 see §9).
- [ ] **Working-hours** preview/overrides — dates + times honor format (time
      honors 12/24h).

---

## 5. Date INPUT surfaces (shared `<DateTimePicker>`)

Each of these was swapped from a native input to the shared picker. For each:
open it, confirm the **calendar renders in your week-start**, the displayed value
reads in your **date format**, the time control honors **12/24h**, pick a value,
submit, and confirm the **saved value is correct** (re-open to verify round-trip).

- [ ] **Booking Start Date** + **End Date** (new booking form). Changing Start
      past End auto-bumps End to 18:00 (existing behavior preserved).
- [ ] **Extend booking** end date dialog.
- [x] **Asset reminder** alert date/time (set + edit).
- [ ] **Audit due date** — Edit-audit dialog, Start-audit dialog, Start-from-context.
- [ ] **Admin update** publish date (admin only).
- [ ] **Custom-field DATE** input (asset create/edit) — incl. the **clear** button.
- [ ] **Custom-field DATE** inline edit on asset overview.
- [ ] **Working-hours override** date — the **min** bound must not allow selecting
      a past day, and must allow **today** (🐞 see §9 — off-by-one in −offset zones).
- [ ] **Advanced filters** date inputs — single date, between (start/end), and
      the multi-date ("in dates") variant. Filter results are correct.

> Note: on a phone/native date field the OS picker may differ — these should now
> be the in-app picker on web. Confirm you see the custom Popover calendar.

---

## 6. Exports & PDFs (use the ACTING user's prefs)

Set your prefs to **DD/MM/YYYY + 24-hour** (distinct from US) so leaks are obvious.

- [ ] **Assets CSV export** — reminder/date columns read in your format. (Note:
      raw `createdAt`/`updatedAt` and custom-field DATE columns stay **ISO** on
      purpose, for import round-trip — that's expected, not a bug.)
- [ ] **Bookings CSV export** — from/to/check-in columns in your format.
- [ ] **Notes/activity CSV** (asset, booking, audit, location) — the "Date"
      column in your format.
- [ ] **Booking PDF** — the headline booking window + secondary dates all in your
      format (previously the headline dates were US-ordered — verify they agree now).
- [ ] **Audit receipt PDF** — session dates + note timestamps.
- [ ] **Reports PDF** — generated-at, timeframe, and per-row dates.

> Tip: have a colleague with a **different** date format export the same data —
> each person's export should reflect **their own** prefs.

---

## 7. Emails (use the RECIPIENT's prefs)

This is the subtle one: an email's dates should match **the recipient's** format,
not the sender's. Set up two users in one workspace with **different** date
formats (User A = MM/DD/YYYY, User B = DD/MM/YYYY).

- [ ] **Booking notification** (reserve/assign/update/extend) to both A and B —
      each recipient's copy shows dates in **their own** format. (Check via a mail
      catcher / your dev mail setup.)
- [ ] **Booking check-in reminder / overdue** emails — same, per recipient.
- [ ] **Audit assigned / completed / reminder** emails — per assignee's format.
- [ ] **Stripe trial-ending / invoice** emails — the billed user's format
      (previously hardcoded US `Month D, YYYY`; now reflects their prefs).
- [ ] **Invite email** to a not-yet-registered address — falls back to the default
      (`MM/DD/YYYY`), since there's no user row yet. (Acceptable.)

> Known compromise: the booking **update** email's embedded "what changed" list
> uses the **editor's** prefs (not per-recipient) — the from/to headline dates are
> still recipient-formatted. Confirm that's acceptable.

---

## 8. Timezone behavior

- [ ] Set **Timezone = Asia/Tokyo**. A booking whose stored UTC instant is late
      evening UTC should display on the **next day** in Tokyo. Set
      **America/Los_Angeles** → the same instant may show the **previous** day/time.
      Times shift accordingly.
- [ ] Changing only the **timezone** (not date format) shifts date-**times**
      across all surfaces (bookings, audits, reports).
- [ ] **12h/24h is independent of timezone** now — switching timezone should NOT
      change whether you see `2:05 PM` vs `14:05` (that's controlled by Time format).
- [ ] Confirm consistency across devices: your chosen timezone applies regardless
      of the machine's OS timezone (it's your stored preference, not the browser's).

---

## 9. 🐞 Bug-fix regressions (from PR review — test explicitly)

These were fixed in the review pass; verify they're actually gone. **Best tested
with your timezone set to a negative-offset zone like `America/Los_Angeles`.**

- [ ] **Date-only fields don't shift a day.** Create/edit an asset **custom field
      of type DATE**, set it to **22 June 2026**. It must display as **22/06/2026**
      (or `06/22/2026`) — **never 21 June**. Reload; still the 22nd. Repeat for a
      **saved date-filter chip** and the **working-hours override** date.
- [ ] **Working-hours override min bound.** With a −offset timezone, open the
      override date picker — you must be able to select **today**, and **not** be able
      to select **yesterday** (previously off-by-one).
- [ ] **Invalid/forged timezone doesn't break anything.** (Optional, technical.)
      In the DB, set a user's `timeZone` to a junk value like `Not/AZone`. That user's
      pages should still render dates (falls back to UTC, no crash). Critically:
      trigger a **booking notification** to a workspace where an **admin** has the junk
      timezone — **other recipients still receive their emails** (the corrupted row
      must not break the whole fan-out). Reset the value afterward.

---

## 10. Cross-cutting consistency

- [ ] Pick one page that shows **several** dates (e.g. booking detail). With a
      single format selected, **every** date on it uses the **same** order — no mix
      of `06/22` and `22/06` on one screen. (This was the core failure of the old
      approach — verify it's uniform now.)
- [ ] Run the full matrix quickly: for each of the **3 date formats**, glance at
      the dashboard + a booking + an asset. Then toggle **12h↔24h** once and confirm
      times flip everywhere.
- [ ] **Non-English browser locale** (e.g. set browser to `fr-FR`): month names
      should remain **English** (language/i18n is out of scope), but the **order**
      should follow your chosen format. Confirm nothing renders in French.

---

## 11. Regression / no-harm checks

- [ ] Existing users who **never open the setting** see dates that match what they
      saw before (browser-derived) — no surprise changes.
- [ ] No console errors on any date-heavy page.
- [ ] Booking/audit/reminder forms still **submit and save** correctly after the
      input swap (the picker emits the same wire string the server expects).
- [ ] `pnpm webapp:validate` is green (already confirmed in CI, but a local run is
      a good final gate).

---

### Notes / things to jot while testing

- Anything that still renders in a **wrong/mixed** format → note the exact
  page + field.
- Any **date input** whose saved value differs from what you picked → note the
  form + timezone.
- Any **email** showing the wrong recipient's format → note which email + users.
