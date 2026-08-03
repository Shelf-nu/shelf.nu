# User-level date/time formatting — design

**Status:** Approved (design) — 2026-07-15
**Supersedes:** PR #2654 (`feat/configurable-date-format`), which added an org-level
`dateFormat` wired only into the `DateS` component.
**Scope owner:** webapp

---

## 1. Problem

Dates across the webapp are formatted by keying `Intl.DateTimeFormat` on the
browser's `Accept-Language` header. Non-US workspaces cannot choose a date
format, and ambiguous numeric dates (`06/22/2026` vs `22/06/2026`) are a
recurring source of confusion.

PR #2654 attempted a fix but is display-only and leaky. An audit of every
date-handling surface found:

- **Coverage gap.** The org `dateFormat` is read in exactly one place — `DateS`.
  It does not replace `useHints` (0 of 19 `useHints()` call sites removed, 1
  reads the setting). Everything not routed through `<DateS>` is unaffected:
  - **Server (~26 render sites / ~15 files):** 3 CSV export paths, the reports
    PDF (entirely), the booking & audit PDFs (partially → _internally
    inconsistent within a single document_), 8 booking/audit email sites, and 5
    Stripe billing emails hardcoded to `en-US`.
  - **Client non-DateS (~30 sites / ~20 files):** command palette (booking
    range, audit due date), custom-field date values (asset detail + index
    column + inline edit + asset PDF), calendar header/subtitles, report
    labels & chart axes, filter chips. ~9 render numeric dates that directly
    contradict the reordered `DateS` dates beside them.
  - **Date inputs (~15 native `datetime-local`/`date` fields):** booking
    start/end, reminders, audits, working-hours, filters.
  - **Timezone:** no setting; still 100% browser-cookie derived.
- **Approach is leaky even in scope.** Mapping "date order" → a locale
  (`en-GB`/`en-US`/`en-CA`) drags along everything else the locale controls.
  Verified on Node 22 / ICU 77:
  1. `YYYY_MM_DD` (→ en-CA) is internally inconsistent: numeric → `2026-06-22`
     but any month-name date → `Jun 22, 2026` (month-first).
  2. `dateStyle` pages render `6/22/26` (2-digit) while everything else and the
     live preview show `06/22/2026` — the preview's "matches" promise is false.
  3. Compact dates gain a forced year: `Jun 22` → `22 Jun 2026`.
  4. Non-English orgs get anglicized: a `fr-FR` workspace picking `DD/MM/YYYY`
     loses French month names (`juin` → `Jun`) and its 24h time.

## 2. Goal

Replace the browser-locale-derived formatting path with an **app-wide,
user-level formatting layer** that every date surface — UI, exports, PDFs,
emails, and inputs — resolves through, so all surfaces agree. Reference model:
cal.com's Language & region settings, adapted to Shelf's multi-tenant model.

**Non-goal:** Language / i18n / string translation. Shelf has no translation
infrastructure; that is a separate multi-month initiative. Month/weekday names
remain English.

## 3. Decisions (locked)

| Decision             | Choice                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preference ownership | **User-level** (per-user), cal.com-style. No org default.                                                                                                                                   |
| Settings covered     | **Date format, Time format (12/24h), Start of week, Timezone.** No language.                                                                                                                |
| Defaults             | **Detected from browser hints at user creation** and stored as concrete values (locale → date/time/week; `CH-time-zone` cookie → timezone). Editable afterward. No user-facing "Automatic". |
| Timezone             | **Stored** on the user; detected at creation (and lazily for pre-existing users); overridable.                                                                                              |
| Inputs               | Adopt the **shadcn date-picker pattern** (Radix Popover + `react-day-picker` + time input — all already in-repo) as one shared `<DateTimePicker>`; replace the ~15 native inputs.           |
| No-user contexts     | Cron/system emails to non-users (e.g. invites to a not-yet-registered email) fall back to a hardcoded default (`MM_DD_YYYY` · `H12` · `UTC`).                                               |
| Org column           | **Retire** `Organization.dateFormat` (migration is unmerged on this branch → no prod down-migration).                                                                                       |

## 4. Data model

Add four **nullable** fields to **`User`** in
`packages/database/prisma/schema.prisma`. The enums carry only genuine user
choices — there is **no `AUTO` member**. `null` is the internal
"not-yet-detected" state, resolved by detection-at-creation (new users) or lazy
backfill (existing users); see §5.4.

```prisma
model User {
  // ...
  dateFormat DateFormatPreference? // null → not yet detected (resolve from hints)
  timeFormat TimeFormatPreference? // null → not yet detected
  weekStart  WeekStartPreference?  // null → not yet detected
  timeZone   String?               // IANA name; null → not yet detected
}

enum DateFormatPreference { DD_MM_YYYY MM_DD_YYYY YYYY_MM_DD }
enum TimeFormatPreference { H12 H24 }
enum WeekStartPreference  { MONDAY SUNDAY SATURDAY }
```

- On **user creation** the four fields are written with concrete values detected
  from the request's browser hints (§5.4), so new users are never `null`.
- **Existing users** predate the feature → `null` until their next authenticated
  load lazily snapshots them (§5.4). While `null`, they resolve from live hints —
  i.e. today's behavior — so no one ever sees a wrong default.
- The settings UI always shows the concrete stored value (a `null` field is
  displayed as its hint-derived value); there is no "Automatic" option.
- **Remove** `Organization.dateFormat` and the `DateFormat` enum added by #2654.

**Migration** (single): `CREATE TYPE` for the three new enums; `ALTER TABLE
"User" ADD COLUMN ... ` (nullable, no default → metadata-only, no rewrite);
`ALTER TABLE "Organization" DROP COLUMN "dateFormat"` + `DROP TYPE
"DateFormat"`. Backfill-free (existing rows stay `NULL`, healed lazily).

## 5. Resolution & plumbing (the single seam)

The root cause of #2654's sprawl is wiring into one component. Instead, resolve
prefs **once per request** and expose them through one channel.

### 5.1 The resolved shape

```ts
type ResolvedFormatPrefs = {
  dateFormat: "DD_MM_YYYY" | "MM_DD_YYYY" | "YYYY_MM_DD"; // null already resolved
  timeFormat: "H12" | "H24";
  weekStart: 0 | 1 | 6; // day index (Sun=0)
  timeZone: string; // IANA, always concrete
};
```

A pure resolver `resolveFormatPrefs(userPrefs, hints)` turns the raw
user fields (any of which may be `null`) + browser hints into a fully concrete
`ResolvedFormatPrefs`. This is the ONLY place a `null` field is interpreted: a
`null` field falls back to `detectFormatPrefsFromHints(hints)` (§5.4), and if
hints are absent to the hardcoded default (`MM_DD_YYYY` · `H12` · `Sunday` ·
`UTC`).

### 5.2 Client seam

- The **root loader** (`app/root.tsx`) already builds `requestInfo.hints`. Extend
  it to also resolve and return `requestInfo.formatPrefs` (resolve the current
  user's prefs against hints; if no session, all fields are `null` → hints govern).
  `requestInfo` is available app-wide via `useRequestInfo()`, including
  auth/onboarding pages (where there is no user → hints govern, i.e. today's
  behavior).
- New hook `useFormatPrefs()` → reads `requestInfo.formatPrefs`.
- New hook `useDateFormatter()` → returns `{ formatDate, formatTime,
formatDateTime }` bound to the resolved prefs. No prop-drilling to the ~50
  client sites.

### 5.3 Server seam

- `resolveUserFormatPrefsById(userId, tx?)` → fetches the user's four fields and
  resolves them. In steady state these are concrete (written at creation), so no
  hints are needed. A still-`null` field (existing user not yet lazily backfilled)
  falls back to the hardcoded default when no request hints are available; when
  the server code is request-scoped (loaders), pass
  `resolveFormatPrefs(userPrefs, getClientHint(request))` so a still-`null` acting
  user's own browser governs.
- `formatDate(value, prefs, opts)` — the same pure formatter the client uses
  (runs in both environments).
- **Exports / PDFs** resolve the **acting** user's prefs.
- **Emails** resolve the **recipient** user's prefs (fetch the four fields on the
  recipient row already loaded by the send path). Because prefs are detected at
  creation, registered recipients almost always have concrete values — the
  send-time "no browser" problem is a non-issue. Only recipients who are not yet
  users (e.g. invites to an unregistered email) → hardcoded default.

### 5.4 Detection at creation + lazy backfill

- `detectFormatPrefsFromHints(hints)` — a pure function mapping browser hints to
  concrete enum values:
  - **dateFormat**: inspect the order of `year`/`month`/`day` parts from
    `Intl.DateTimeFormat(locale).formatToParts(refDate)` → `DD_MM_YYYY` /
    `MM_DD_YYYY` / `YYYY_MM_DD`.
  - **timeFormat**: `Intl.DateTimeFormat(locale, { hour: "numeric" })
.resolvedOptions().hour12` → `H12` / `H24`.
  - **weekStart**: `new Intl.Locale(locale).weekInfo?.firstDay` where supported,
    with a region-based fallback table (engine support for `weekInfo` varies).
  - **timeZone**: the `CH-time-zone` hint value directly.
    Fully unit-tested against representative locales.
- **At user creation** (standard signup, invite-accept, SSO first login — every
  path runs in a request with hints): call `detectFormatPrefsFromHints` and write
  the four concrete values on the new `User` row. Enumerate the exact creation
  call sites during planning (`modules/user/service.server.ts` `createUser` and
  its callers).
- **Lazy backfill** for pre-existing users: in the root loader, if the
  authenticated user has any `null` formatting field, write the hint-detected
  values once (idempotent, fire-and-forget, mirrors the existing
  `lastMobileActiveAt` debounced-write pattern). After one authenticated load the
  user has concrete prefs; until then they resolve from live hints.

## 6. Core formatter (decouples order from locale)

The fix for the locale-baggage bug: **never swap the Intl locale to change
order.** The formatter separates timezone conversion (needs Intl) from
presentation (must be deterministic):

1. Use `Intl.DateTimeFormat("en-US", { timeZone, ...numericFields })` +
   `formatToParts()` to (a) correctly convert UTC → the user's timezone and
   (b) extract numeric `year/month/day/hour/minute` parts and English
   `month`/`weekday` names.
2. **Reassemble** the parts per the resolved prefs:
   - order + separator from `dateFormat` (`/` for D-M/M-D, `-` for Y-M-D),
   - zero-padding as specified,
   - month as number or English name per the caller's `month` option,
   - `hour12` from `timeFormat`.

This is deterministic, identical on server and client, timezone-correct, and has
zero locale leakage.

### 6.1 Compatibility surface

`formatDate`/`DateS` must accept the option shapes callers pass today so the
sweep is mechanical:

- `month: "numeric" | "2-digit" | "short" | "long"`, `weekday`, `year`, `day`
- `dateStyle`/`timeStyle` shortcuts → mapped to explicit fields internally
  (never passed to Intl alongside granular fields; the current TypeError trap
  disappears because we control assembly).
- `includeTime`, `onlyTime`, `localeOnly` (absolute dates, no tz conversion —
  still honors order/format prefs, unlike today where it defaults to en-US).

Partial-date callers (e.g. `{ month: "short", day: "numeric" }`) render exactly
those fields in the pref order — **no forced year** (fixes bug #3).

## 7. The sweep (complete fix)

Route every date render through the layer. Grouped by the audit:

1. **`DateS`** (`app/components/shared/date.tsx`) → read `useDateFormatter()`;
   delete the `resolveDateFormat` locale hack + `app/utils/date-format.ts`
   locale-mapping.
2. **~30 client non-DateS sites** → replace `toLocaleDateString` / hand-rolled
   formatting with `<DateS>` or `useDateFormatter()`. Kill every hardcoded
   `en-US`. Key: command palette, custom-field values (asset detail, index
   column, inline edit), calendar titles/subtitles, report labels + chart axes,
   filter-preset chips.
3. **~26 server sites** → replace `getDateTimeFormat(request)` / `getClientHint`
   date formatting with `formatDate(value, prefs, opts)`:
   - CSV: `app/utils/csv.server.ts` (assets, notes, bookings) — acting user.
   - PDFs: `audits/bookings/reports.$id.generate-pdf.tsx` + pdf-helpers — acting user.
   - Emails: booking + audit `email-helpers` and HTML templates — recipient user.
   - Stripe trial emails (5 files) — recipient user (removes hardcoded en-US).
4. **Timezone** now flows from the resolved prefs everywhere it was
   browser-cookie-only.

## 8. Inputs — shared `<DateTimePicker>`

One shared component in the webapp component library, composed shadcn-style
(Radix Popover + `react-day-picker` Calendar + a time input), mirroring the
existing `app/components/reports/timeframe-picker.tsx`:

- Renders and parses in the user's `dateFormat` + `weekStart` + `timeFormat`.
- Accepts/emits a UTC ISO string for form submission; a text input allows typing.
- Variants: date, date-time, (range where needed).
- Replaces the ~15 native inputs: booking start/end
  (`booking/forms/fields/dates.tsx`), extend-booking, reminder dialog, audit
  dialogs (edit/start/from-context), update publish date, working-hours
  override, custom-field DATE input, advanced date filters, asset overview date.
- This is the largest chunk → its own plan phase; the display sweep can precede
  it.

## 9. Settings UI

Account **"Language & region"** card (per the cal.com reference), on the account
settings page (`account-details.general.tsx`, or a dedicated
`account-details.language-region` sub-tab):

- Four Radix `Popover`-selects: Date format · Time format · Start of week · Timezone.
  Each shows the concrete current value; a `null` field is displayed as its
  hint-detected value (never "Automatic").
- A live **"Dates will look like …"** preview using the shared formatter.
- One Update action wired to a new user-prefs update path (`updateUser` /
  dedicated action), validated with Zod against the enums + IANA list. Saving
  writes concrete values (also clears any remaining `null`).
- Remove the two workspace-level `DateFormatSelector` placements added by #2654
  (`settings.general.tsx`, `account-details.workspace.$workspaceId.edit.tsx`).

Detection is handled at creation + lazy backfill (§5.4), so by the time a user
opens this card the fields are already populated with their detected values.

## 10. Testing

- **Formatter unit tests**: each `dateFormat` × `timeFormat` × representative
  timezones, including the previously-broken cases (YYYY-MM-DD with month names;
  `dateStyle` shortcuts; partial dates with no year; DST boundaries).
- **Resolver tests**: `null` fields fall back to hints; hardcoded default when no
  hints and no stored value.
- **Detection tests**: `detectFormatPrefsFromHints` maps representative locales
  (en-US, en-GB, de-DE, ja-JP, fr-FR, en-CA, …) to the correct enum values for
  all four axes, including the `weekInfo` fallback table.
- **Picker tests**: parse ↔ format round-trip in each format; week-start
  rendering; UTC emission.
- **Server parity test**: `formatDate` produces identical output to the client
  path for the same prefs (guards the "internally consistent across surfaces"
  invariant).
- Keep `pnpm webapp:validate` green.

## 11. Migration & rollout

- Single Prisma migration (§4). Backfill-free; existing users read back `null`
  and resolve from live hints (today's behavior) until lazily backfilled on their
  next authenticated load (§5.4).
- `Organization.dateFormat` drop is safe because #2654 is unmerged (never
  deployed).
- No feature flag needed: detection-from-hints makes every user's initial
  rendering match what they see today; the layer only diverges once a user edits
  their prefs.

## 12. Out of scope / deferred

- Language / i18n / translated month names.
- Per-workspace format defaults (chose pure user-level).
- cal.com's "Schedule timezone change" (YAGNI).
- Companion mobile app (owned by another team; coordinate separately).

## 13. Key files

- Schema: `packages/database/prisma/schema.prisma` (+ new migration dir).
- Formatter + resolver + detection: `app/utils/date-format.ts` (rewrite —
  `formatDate`, `resolveFormatPrefs`, `detectFormatPrefsFromHints`),
  new `app/utils/date-format.server.ts` seam if needed.
- Client hooks: `app/hooks/use-date-formatter.ts`, `use-format-prefs.ts`.
- Plumbing: `app/root.tsx` (requestInfo.formatPrefs + lazy backfill),
  `app/utils/request-info.ts`.
- Creation hook: `app/modules/user/service.server.ts` (`createUser` +
  invite/SSO paths — detect & persist prefs).
- Display component: `app/components/shared/date.tsx` (`DateS`).
- Picker: `app/components/shared/date-time-picker.tsx` (new).
- Settings: account-details general/language-region route + selector component.
- Sweep targets: enumerated in §7 (full file list produced during planning).
