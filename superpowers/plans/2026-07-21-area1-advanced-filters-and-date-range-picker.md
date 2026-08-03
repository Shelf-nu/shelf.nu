# Area 1 — Advanced Filter Date Consistency + Reusable DateRangePicker

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make advanced asset-index date filters timezone- and format-consistent with the user-level date system, and introduce a reusable shadcn-style `DateRangePicker` used by both the "between" filter and the reports custom-range.

**Architecture:** Fix a pre-existing UTC-vs-display off-by-one in the SQL date filter by threading the acting user's resolved pref timezone into `generateWhereClause → addDateFilter` (built-in `timestamptz` columns only). Thread `prefs.timeZone` into the filter input components (replacing browser-hint tz). Extend the picker's `dateFormatTokens` for the new month-name formats. Build one shared `DateRangePicker` (react-day-picker `mode="range"`) and swap it into both consumers.

**Tech Stack:** Remix/React Router 7, Prisma raw SQL (`Prisma.sql`), react-day-picker v9, Radix Popover, Luxon/date-fns-tz, Vitest.

## Global Constraints

- Display everywhere via `formatDate`/`<DateS>`/`useDateFormatter`; never raw `toLocaleDateString`.
- Server-side pref tz = `(await resolveUserFormatPrefsById(userId, getClientHint(request))).timeZone`; client-side = `useFormatPrefs()`/`useDateFormatter().prefs.timeZone`.
- Custom-field DATE values are already date-only → **no** tz change (`addCustomFieldDateFilter` untouched).
- `getTodayInUserTimezone(tz)` already exists (`app/utils/date-fns.ts:233`) → reuse.
- Run `pnpm webapp:test -- --run <file>` (never watch); `pnpm webapp:validate` before finishing. Do NOT commit (user commits).
- No new migrations. No companion changes (separate area).

---

## File Structure

**Create**

- `app/components/shared/date-range-picker.tsx` — the reusable range picker.
- `app/components/shared/date-range-picker.test.tsx` — component tests.

**Modify (server / filter correctness)**

- `app/modules/asset/query.server.ts` — `addDateFilter` + `generateWhereClause` gain a `timeZone` param.
- `app/modules/asset/service.server.ts` — `getAdvancedPaginatedAndFilterableAssets` gains + threads `timeZone`.
- `app/modules/asset/bulk-operations-helper.server.ts` — pass `timeZone` to `generateWhereClause`.
- `app/routes/_layout+/assets._index.tsx` (loader + bulk action) — resolve pref tz, pass down.
- `app/utils/csv.server.ts` (`resolveExportAssets`) — pass pref tz to the fetch (export path already resolves prefs).
- `app/modules/asset/query.server.test.ts` — non-UTC date-filter test.

**Modify (filter input consistency)**

- `app/components/shared/date-time-picker.tsx` — extend `dateFormatTokens` (`:132-142`) for month-name.
- `app/components/assets/assets-index/advanced-filters/value-field.tsx` — `useHints().timeZone` → `prefs.timeZone`; swap the "between" branch to `DateRangePicker`.
- `app/components/assets/assets-index/advanced-filters/helpers.ts` — date default via `getTodayInUserTimezone` (`:158,175`).
- `app/utils/date-fns.ts` — audit/simplify `adjustDateToUTC` / `adjustDateToUserTimezone` if redundant.

**Modify (reports consumer)**

- `app/components/reports/timeframe-picker.tsx` — custom-range uses `DateRangePicker`; serialize boundaries in pref tz.

---

## Task 1 — Fix the off-by-one date filter (pref-tz `::date`)

**Files:** `query.server.ts`, `service.server.ts`, `bulk-operations-helper.server.ts`, `assets._index.tsx`, `csv.server.ts`, `query.server.test.ts`

**Interfaces:**

- Produces: `generateWhereClause(organizationId, search, filters, assetIds?, availableToBookOnly?, timeZone = "UTC")`; `addDateFilter(whereClause, filter, timeZone)`.
- `getAdvancedPaginatedAndFilterableAssets({ ..., timeZone? })`.

**Root cause:** `addDateFilter` (`query.server.ts:437`) compares `a."col"::date = value::date`. `col` is `timestamptz`; `::date` resolves the day in the DB session tz (UTC), while the row is displayed in `prefs.timeZone` → off-by-one for non-UTC users. Pre-existing in `origin/main` (our branch never touched this file).

- [ ] **Step 1 — failing test.** In `query.server.test.ts` (has `describe("generateWhereClause …")` at ~310), add: an `is` date filter on `createdAt` with `timeZone: "Asia/Tokyo"` produces SQL containing `AT TIME ZONE` and `'Asia/Tokyo'` (assert via `getSqlString`). Run → FAIL.
- [ ] **Step 2 — `addDateFilter`.** Add a `timeZone: string` param. For `is/isNot/before/after/between/inDates`, wrap the column: `(a."<col>" AT TIME ZONE ${timeZone})::date` (bind `timeZone` as a param). Leave the RHS `${filter.value}::date` as-is (date-only string).
- [ ] **Step 3 — `generateWhereClause`.** Add trailing `timeZone: string = "UTC"` param; pass to `addDateFilter` (`:156`). Default "UTC" preserves behavior for callers that don't pass it.
- [ ] **Step 4 — thread through fetch.** `getAdvancedPaginatedAndFilterableAssets` (service.server.ts): add optional `timeZone?: string` to its param object; pass to its internal `generateWhereClause` call.
- [ ] **Step 5 — resolve at entry points.** In `assets._index.tsx` loader (and the bulk action) resolve `const { timeZone } = await resolveUserFormatPrefsById(userId, getClientHint(request))` and pass `timeZone` to `getAdvancedPaginatedAndFilterableAssets`. Do the same in `csv.server.ts:resolveExportAssets` (it has `request`; thread a `userId`/`timeZone` — the human export already resolves prefs, reuse it) and `bulk-operations-helper.server.ts` (has `userId`).
- [ ] **Step 6 — leave custom-field DATE alone.** Confirm `addCustomFieldDateFilter` (`:241`) is unchanged (values are date-only).
- [ ] **Step 7 — run** `query.server.test.ts` → PASS. Add a second assertion that a custom-field DATE filter does **not** get `AT TIME ZONE`.

---

## Task 2 — `dateFormatTokens`: month-name prefs map to NUMERIC-order tokens

**Files:** `date-time-picker.tsx`

**Decision (user):** typeable date inputs stay **numeric** even when the display preference is month-name (consistent with the shipped DateTimePicker — you can't reliably type "Jul"). Map each month-name pref to its correct numeric ORDER so the input isn't confusing. No month-name parsing → no date-fns parse risk.

- [ ] **Step 1 — failing test** (`date-time-picker.test.tsx`): a `DD_MMM_YYYY` pref renders the typeable text input as `dd/MM/yyyy` order (e.g. `20/07/2026`), and a `MMM_DD_YYYY` pref renders `MM/dd/yyyy` (e.g. `07/20/2026`); typed numeric round-trips to the `2026-07-20` wire. Run → FAIL.
- [ ] **Step 2 — implement.** In `dateFormatTokens` (`:132-142`) add `case "MMM_DD_YYYY": return "MM/dd/yyyy";` and `case "DD_MMM_YYYY": return "dd/MM/yyyy";` (leave the `default` as-is). Add a short `// why:` note that month-name is display-only; typeable input stays numeric in the matching order.
- [ ] **Step 3 — run** → PASS. (No date-fns month-name parsing involved.)

---

## Task 3 — Thread pref tz into filter inputs

**Files:** `value-field.tsx`

- [ ] **Step 1.** Replace `useHints().timeZone` (`:2124`) with `useDateFormatter().prefs.timeZone` (or `useFormatPrefs().timeZone`). Update `DateField` + the `timeZone` prop passed to `MultiDateInput` so `adjustDateToUTC`/`adjustDateToUserTimezone` use the pref zone.
- [ ] **Step 2.** Confirm typecheck + existing value-field tests pass. (Behavior is near-identity for date-only; this is correctness/consistency.)

---

## Task 4 — Seed new date filters in user tz

**Files:** `helpers.ts`

- [ ] **Step 1.** At `getDefaultValueForFieldType` (`:158,175`), replace `new Date().toISOString().split("T")[0]` with `getTodayInUserTimezone(prefs.timeZone)`. Thread `prefs`/`timeZone` into the helper's signature if not present; update its call sites (a value-field/helpers unit test if one exists, else add one).
- [ ] **Step 2.** Run helpers tests → PASS.

---

## Task 5 — Audit `adjustDate*` helpers

**Files:** `date-fns.ts`, `value-field.tsx`

- [ ] **Step 1.** Read `adjustDateToUTC` / `adjustDateToUserTimezone` bodies. Once Task 3 threads the pref tz, determine whether the DateTimePicker's date-only wire can be passed straight through (the helpers may be a near-identity round-trip). If redundant, remove them and simplify value-field; otherwise leave with a clarifying comment. Keep this change behavior-preserving (covered by existing tests).

---

## Task 6 — Reusable `DateRangePicker` + swap both consumers

**Files:** `date-range-picker.tsx` (new), `date-range-picker.test.tsx` (new), `value-field.tsx`, `timeframe-picker.tsx`

**Interfaces (public API):**

```ts
type DateRangeValue = { from?: Date; to?: Date };
type DateRangePickerProps = {
  value?: DateRangeValue;
  onChange?: (range: DateRangeValue) => void;
  /** When set, renders hidden inputs with date-only wires (YYYY-MM-DD) for form submit. */
  startName?: string;
  endName?: string;
  placeholder?: string; // default "Select start and end date"
  min?: Date;
  max?: Date;
  disabled?: boolean;
  error?: string;
  className?: string;
};
```

- Deals in **calendar dates** (date-only). Consumers apply tz boundaries. Trigger label via `useDateFormatter`: empty → placeholder; start-only → `"Jul 20, 2026 – …"`; complete → `"Jul 20, 2026 – Jul 24, 2026"`.

- [ ] **Step 1 — extract shared calendar styling.** Pull `RDP_STYLE`, `RDP_CLASS_NAMES`, `CalendarChevron` out of `date-time-picker.tsx` into a small shared module (e.g. `app/components/shared/calendar-styles.tsx`) so both pickers render 1:1 shadcn. Import them back into `date-time-picker.tsx` (no visual change — verify picker tests still pass).
- [ ] **Step 2 — failing component tests** (`date-range-picker.test.tsx`): (a) empty renders the placeholder; (b) `value={{from,to}}` renders `"Jul 20, 2026 – Jul 24, 2026"` (with a month-name pref via the mocked `useDateFormatter`); (c) `startName`/`endName` render hidden inputs with `2026-07-20` / `2026-07-24`. Run → FAIL.
- [ ] **Step 3 — implement.** Build with Radix `Popover` + react-day-picker `<DayPicker mode="range" numberOfMonths={2}>` using the shared styling + `CalendarChevron`; `selected`/`onSelect` map to `{from,to}`; render hidden inputs when names given; format the trigger label. Run → PASS.
- [ ] **Step 4 — swap "between" filter.** In `value-field.tsx` replace the two `DateTimePicker`s in the `operator === "between"` branch with one `DateRangePicker` using `startName={`${name}_start`}` / `endName={`${name}\_end`}` (emits the same wires; server logic unchanged). Keep a visible helper text/label so a single-row filter clearly reads "select start and end date".
- [ ] **Step 5 — swap reports custom-range.** In `timeframe-picker.tsx` replace the inline `DayPicker` custom-range with `DateRangePicker` (controlled `value`/`onChange`). On change, convert `{from,to}` to **start-of-day / end-of-day in `prefs.timeZone`** before serializing to URL params (fixes the `.toISOString()` browser-tz bug flagged in the reports scope). Keep the preset buttons as-is.
- [ ] **Step 6 — run** both consumers' tests + `date-time-picker.test.tsx` (unchanged after the style extraction) → PASS.

---

## Final

- [ ] Run `pnpm webapp:validate` → green (typecheck + lint + all tests).
- [ ] Do NOT commit — hand back to the user with a summary + the manual-QA checklist (non-UTC pref tz + month-name pref: filter by createdAt on the day a row shows; between-range filter; reports custom range).

## Self-Review notes

- Spec coverage: bug (T1), tokens (T2), input tz (T3), default seed (T4), helper audit (T5), range picker + both consumers (T6) — all mapped.
- Type consistency: `timeZone` param name used identically across `addDateFilter`/`generateWhereClause`/`getAdvancedPaginatedAndFilterableAssets`. `DateRangeValue` shape shared by component + both consumers.
- Risk: `AT TIME ZONE` param binding (T1) — verify Prisma emits `AT TIME ZONE $1` not a cast error; the test asserts the SQL string. (The date-fns month-name parse risk is removed — Task 2 keeps typeable inputs numeric.)
