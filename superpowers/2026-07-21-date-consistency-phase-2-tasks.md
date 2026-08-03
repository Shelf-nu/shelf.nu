# Date Consistency — Phase 2 Task List

_Grounded from a read-only codebase sweep on 2026-07-21. Follows the shipped
user-level date/time format system (`formatDate` / `DateS` / `DateTimePicker`,
prefs = dateFormat/timeFormat/weekStart/timeZone, input parsed in pref tz)._

Three areas, in recommended execution order. **Area 1** is small (one real
bug), **Area 2** is medium, **Area 3** (companion) is the largest and is
release-gated.

---

## Area 1 — Advanced asset index date filters

**Display is already consistent** (createdAt/updatedAt via `<DateS>`, custom-field
DATE via `formatDate(localeOnly)`). The gaps are in filter **inputs + boundaries**:

| #   | Task                                                                                                                                                                                                                                                                                                                                                                  | File(s)                                                     | Severity |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| 1.1 | **Real bug:** `createdAt`/`updatedAt` filter compares `col::date = value::date`, which resolves the day in UTC, while the row is displayed in the user's tz → **off-by-one match** when tz ≠ UTC. Compare `(col AT TIME ZONE prefTz)::date` for is/before/after/between/inDates. Thread pref tz into `getAssetsWhereInput`/`parseFilters`. Add a non-UTC server test. | `modules/asset/query.server.ts:437-476`                     | **High** |
| 1.2 | Extend `dateFormatTokens` to cover the 2 new month-name prefs (`MMM_DD_YYYY`, `DD_MMM_YYYY`) so the typeable filter input isn't stuck on `MM/dd/yyyy` while `<DateS>` shows "Jul 20". _(Loose end from what we just shipped — affects **all** typeable pickers, not just filters. Could be a quick immediate follow-up.)_                                             | `components/shared/date-time-picker.tsx:132-142`            | Med      |
| 1.3 | Thread `prefs.timeZone` (not `useHints().timeZone`) into `DateField` + `MultiDateInput` so filter round-trip zone matches display. (Near-identity for date-only today, but conceptually wrong.)                                                                                                                                                                       | `advanced-filters/value-field.tsx:2124,2143-2166,2317-2335` | Low      |
| 1.4 | Seed new date filters with `getTodayInUserTimezone(prefs.timeZone)` instead of UTC `new Date().toISOString()` (off-by-one near midnight).                                                                                                                                                                                                                             | `advanced-filters/helpers.ts:158,175`                       | Low      |

---

## Area 2 — Reports

**Display mostly consistent** (table `DateCell` → `DateS`; the PDF route is the
**reference-correct** model — resolves prefs via `resolveUserFormatPrefsById` and
formats server-side). Gaps:

| #   | Task                                                                                                                                                                                                                                                                      | File(s)                                                                           | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------- |
| 2.1 | **Timeframe PRESET boundaries** (Today / This month / quarter / year / Last N) computed in machine-local time → wrong **query window** when tz ≠ machine. Compute boundaries as wall-clock in `prefs.timeZone` (Luxon `setZone().startOf(...)`). Test under a non-UTC tz. | `modules/reports/timeframe.ts:34-156`                                             | **High** |
| 2.2 | **Custom range picker** serializes browser-local-midnight Dates via `.toISOString()` → boundary reflects browser tz. Interpret from/to as calendar dates in `prefs.timeZone` (start/end-of-day) before serializing.                                                       | `components/reports/timeframe-picker.tsx:123-144`                                 | **High** |
| 2.3 | **CSV export** hardcodes ISO/UTC date-only, ignoring the prefs the route already fetches + dropping time. Thread `formatPrefs` into the CSV generators → `formatDate(date, prefs, …)`. **DECISION NEEDED** (open q below).                                                | `routes/_layout+/reports.export.$fileName[.csv].tsx:422-425,617`                  | Med      |
| 2.4 | Asset-Activity "Date & Time" column renders **date only** (DateCell is always date-only). Give `DateCell` an optional `includeTime`/`options` passthrough; use it for activity `occurredAt`. Audit booking due-date columns for time too.                                 | `components/reports/report-table.tsx:306-319`, `asset-activity-content.tsx:92-94` | Med      |
| 2.5 | Chart-axis label tz is internally inconsistent (day/week use server-local getters, month uses UTC). Make day/week labels UTC too (keep the documented English-name decision).                                                                                             | `modules/reports/helpers.server.ts:774-801,3339-3343`                             | Low      |
| 2.6 | Remove (or prefs-thread) `parseTimeframeFromParams` — **dead code** that would emit US-default labels if reused.                                                                                                                                                          | `modules/reports/timeframe.ts:203-216`                                            | Low      |
| 2.7 | Regression test: a `DD_MM_YYYY` + `Asia/Tokyo` user gets DD/MM ordering + JST day boundaries across loader label / CSV / PDF.                                                                                                                                             | —                                                                                 | —        |

---

## Area 3 — Companion app (React Native / Expo) — **largest, release-gated**

**Completely disconnected** from the prefs system: displays via device-locale
`toLocaleDateString`, inputs send a device-local wall-clock + **device** tz, and
`/api/mobile/me` **does not even return the prefs**.

### Sequencing note

- **3.1 (server) ships independently** via a normal webapp deploy — backward-compatible (old app ignores new fields). Do this first; it unblocks the client.
- **3.2–3.8 (client)** all ship in a **new native binary + store submission** — there is **no OTA/EAS Update channel configured**, and there's an **App Store review in progress (v1.2.0)**. Client work is gated behind that review + a store submission. Coordinate with the companion-owning team.

| #   | Task                                                                                                                                                                                                                                | File(s)                                                                                  | Ships as      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- |
| 3.1 | **SERVER FIRST:** add `dateFormat/timeFormat/weekStart/timeZone` to the `requireMobileAuth` user select + return them from `/api/mobile/me`. (Resolve server-side vs return raw — decision below.)                                  | `webapp: modules/api/mobile-auth.server.ts:74-83`, `routes/api+/mobile+/me.ts`           | Webapp deploy |
| 3.2 | Add prefs to companion `MeResponse` type + fetch/cache; thread through the auth/org context.                                                                                                                                        | `companion: lib/api/types.ts:19-28`                                                      | Native build  |
| 3.3 | **Port the pure formatter** (`date-format.ts`, ~608 lines, type-only Prisma deps) into the companion.                                                                                                                               | `companion: lib/date-format.ts` (new)                                                    | Native build  |
| 3.4 | **VERIFY Hermes `Intl.formatToParts` + explicit `timeZone`** on iOS **and** Android release builds before trusting the port. If Android lacks full ICU → add `@formatjs` polyfill (bundle-size cost). **Blocker to de-risk early.** | —                                                                                        | —             |
| 3.5 | Replace the 4 duplicated display helpers with the ported formatter + a companion `useDateFormatter` analog.                                                                                                                         | `companion: lib/constants.ts:180-195`, `home.tsx:425-429`, `bookings/new.tsx`,`edit.tsx` | Native build  |
| 3.6 | Fix input tz: send the user's **pref** tz (fallback device tz when null) from booking create/edit/actions instead of `getTimeZone()` (device).                                                                                      | `companion: bookings/new.tsx:48`, `edit.tsx:43`, `[id].tsx:215`                          | Native build  |
| 3.7 | Compute audit due/overdue calendar-day math in pref tz (not device-local getters).                                                                                                                                                  | `companion: lib/audit-format.ts:42-65`                                                   | Native build  |
| 3.8 | Companion unit tests: formatter matches webapp per format combo; pref-tz≠device-tz produces correct wall-clock on create.                                                                                                           | —                                                                                        | Native build  |

---

## Decisions needed before/while building

1. **CSV export format (2.3):** machine-readable **ISO/UTC** (spreadsheet-friendly) or the user's **display prefs**? Determines "make prefs-aware" vs "document ISO".
2. **Report table due-dates (2.4):** show **time** (like the at-risk widget) or keep **date-only** compact tables?
3. **Timeframe preset anchor (2.1):** user **pref tz**, **workspace tz**, or browser tz? Reports are workspace-analytics — a workspace-tz anchor may be more intuitive for shared reports, but diverges from the rest of the feature (pref tz).
4. **Companion `/me` (3.1):** return **resolved** prefs (server applies defaults, one source of truth) or **raw nullable** (client resolves)? _Recommend resolved._
5. **Companion null-pref fallback (3.6):** fall back to **device** tz/locale (friendlier) or the **UTC/US hardcoded default** (matches webapp backstop)?
6. **Companion OTA (big one):** establish an **EAS Update / expo-updates** channel now? Without it, this parity work **and all future companion JS fixes** are permanently gated behind store review. One-time investment worth deciding with the companion team.
7. **Companion weekStart on native picker (3.5):** honoring `weekStart` may require replacing the native `@react-native-community/datetimepicker` with a JS picker — larger UX change; likely defer.
