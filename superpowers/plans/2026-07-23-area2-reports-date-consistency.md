# Area 2 — Reports Date Consistency Implementation Plan

> **For agentic workers:** execute task-by-task, subagent-driven. Each task ends
> with a targeted test + a commit. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every user-facing report date obey the acting user's resolved
format prefs (order, numeric-vs-name, separator, timezone), and anchor all
timeframe query windows in the user's pref timezone.

**Architecture:** Reports already resolve prefs server-side
(`resolveUserFormatPrefsById`) and render client dates through `DateS`
(`useDateFormatter` → `formatDate`). The bugs are (a) components/helpers that
pass hardcoded Intl options (`month:"short"`) which override the pref's numeric
style, and (b) preset boundary math done in machine-local time. Fix at the
shared choke points: `resolveTimeframe` (boundaries), `DateCell` (table dates),
the two range indicators, `formatDateForCsv` (export).

**Tech Stack:** Remix/React Router 7, TypeScript, Luxon (tz math), `formatDate`
(pure formatter), Vitest.

## Global Constraints

- **NEVER run `pnpm webapp:validate`** — its forked vitest pool + hooks froze the
  machine. Run TARGETED files only: `pnpm --filter @shelf/webapp test -- --run <path>`.
  `pkill -f vitest` after each run. Never two heavy node processes at once.
- All user-facing **data dates** render via `DateS` / `formatDate(value, prefs)`
  with **no** `month`/`day`/`year`/`dateStyle` shape options — the pref decides
  numeric-vs-name, order, separator. Never `toLocaleDateString` for data dates.
- **Kept English by product decision** (do NOT convert): month-group **headers**
  (`formatMonthLabel` → "April 2026") and **chart axis ticks**
  (`helpers.server.ts` `toLocaleDateString("en-US", …)` → "Jul"/"Mon"). Only their
  ORDER may be pref-driven; month/weekday stay English NAMES.
- Timeframe **preset boundaries** and the **custom range** are anchored in
  `prefs.timeZone` (user pref tz — confirmed decision), via Luxon.
- **CSV export = display mode** per prefs; include the time part for datetime
  fields (scheduledStart/End, occurredAt, assignedAt), date-only for date fields.
- JSDoc on every new/changed export. No phase/sprint references in code comments
  (PR description carries that). `SHELF_SEC_REVIEW=0` on commits.
- Reports are read-only → no `recordEvent`.

---

### Task 1: Anchor preset boundaries in the user's pref timezone

**Files:**

- Modify: `apps/webapp/app/modules/reports/timeframe.ts` (`resolveTimeframe`, ~28–156)
- Test: `apps/webapp/app/modules/reports/timeframe.test.ts` (extend)

**Interfaces:**

- Consumes: `prefs.timeZone` (already the 4th param, defaulting to
  `HARDCODED_DEFAULT_PREFS`). Luxon `DateTime`.
- Produces: unchanged `ResolvedTimeframe` shape; `from`/`to` are now wall-clock
  boundaries in `prefs.timeZone` converted to `Date` via `.toJSDate()`.

The current code uses machine-local `new Date(now.getFullYear(), now.getMonth(),
now.getDate())` etc. Replace the boundary math with Luxon anchored in the pref
zone. `to` stays "now" for rolling presets; month/quarter/year use `startOf`.

- [ ] **Step 1: Write the failing test** (append to `timeframe.test.ts`)

```ts
import { DateTime } from "luxon";
// why: preset windows must be wall-clock in the user's pref tz, not machine tz.
it("anchors 'this_month' start at midnight in the user's pref timezone", () => {
  const tokyo = { ...ddmmyyyy, timeZone: "Asia/Tokyo" } as ResolvedFormatPrefs;
  const { from } = resolveTimeframe("this_month", undefined, undefined, tokyo);
  const startInTokyo = DateTime.fromJSDate(from).setZone("Asia/Tokyo");
  expect(startInTokyo.day).toBe(1);
  expect(startInTokyo.hour).toBe(0);
  expect(startInTokyo.minute).toBe(0);
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm --filter @shelf/webapp test -- --run app/modules/reports/timeframe.test.ts`
Expected: FAIL (start resolves in machine tz, hour ≠ 0 in Tokyo off-machine).

- [ ] **Step 3: Rewrite boundary math with Luxon** in `resolveTimeframe`.

Replace the `now`/`today` seed and each preset's `from`/`to` with pref-tz Luxon:

```ts
const zone = prefs.timeZone ?? "UTC";
const now = DateTime.now().setZone(zone);
const startOfToday = now.startOf("day");
// today:        from = startOfToday,                 to = now
// last_7d:      from = startOfToday.minus({ days: 6 })
// last_30d:     from = startOfToday.minus({ days: 29 })
// last_90d:     from = startOfToday.minus({ days: 89 })
// this_month:   from = now.startOf("month"),         to = now
// this_quarter: from = now.startOf("quarter"),       to = now
// this_year:    from = now.startOf("year"),          to = now
// all_time:     from = DateTime.fromObject({ year: 2020, month: 1, day: 1 }, { zone })
// Each returned Date via .toJSDate(); `to: now.toJSDate()`.
```

Keep the `label` values as they are today (labels handled in Task 2/5). Keep the
internal fallback `resolveTimeframe("last_30d")` calls — they default to UTC,
acceptable for error paths.

- [ ] **Step 4: Run the test, expect PASS.** Also re-run the whole file to ensure
      the existing label tests still pass.

Run: `pnpm --filter @shelf/webapp test -- --run app/modules/reports/timeframe.test.ts`
Then: `pkill -f vitest`

- [ ] **Step 5: Commit** `fix(reports): anchor timeframe preset boundaries in the user's timezone`

---

### Task 2: Report data-date display follows the user's pref

**Files:**

- Modify: `apps/webapp/app/components/reports/report-table.tsx` (`DateCell`, ~306–319)
- Modify: `apps/webapp/app/components/reports/at-risk-bookings.tsx` (~193)
- Modify: `apps/webapp/app/components/reports/timeframe-range-indicator.tsx`
- Modify: `apps/webapp/app/components/reports/compliance-hero.tsx` (~54)
- Modify: `apps/webapp/app/modules/reports/timeframe.ts` (`formatDateShort`, ~184)
- Test: `apps/webapp/app/components/reports/report-table.test.tsx` (create if absent)

**Interfaces:**

- Produces: `DateCell({ date, includeTime? })` — new optional `includeTime`
  (consumed by Task 3).

The order is already pref-driven; the bug is hardcoded `month:"short"` forcing a
name+space. Drop the shape options so `formatDate` uses the pref's numeric style.

- [ ] **Step 1: Failing test** — assert `DateCell` renders numeric for a
      `DD_MM_YYYY` pref (mock `useDateFormatter` like `dates.test.tsx`).

```tsx
// why: table data dates must follow the pref's numeric style, not "6 Jul 2026".
it("renders a table date in the user's numeric pref format", () => {
  render(
    <table>
      <tbody>
        <tr>
          <td>
            <DateCell date={new Date(2026, 6, 6)} />
          </td>
        </tr>
      </tbody>
    </table>
  );
  expect(screen.getByText("06/07/2026")).toBeTruthy(); // DD_MM_YYYY mock
});
```

- [ ] **Step 2: Run, expect FAIL** (`app/components/reports/report-table.test.tsx`).

- [ ] **Step 3: Implement.**

  - `DateCell`: drop `options`; add `includeTime?: boolean`; pass it through:
    ```tsx
    export function DateCell({
      date,
      includeTime,
    }: {
      date: Date | null;
      includeTime?: boolean;
    }) {
      if (!date) return <span className="text-gray-400">—</span>;
      return (
        <span className="tabular-nums">
          <DateS date={date} includeTime={includeTime} />
        </span>
      );
    }
    ```
    Update the JSDoc (remove the "hardcoded en-US" wording; note pref-driven).
  - `at-risk-bookings.tsx:193`: remove the `options={{ month:"short", day:"numeric" }}`
    (render `<DateS date={…} />`; add `includeTime` if that surface shows time).
  - `timeframe-range-indicator.tsx`: delete the `showYear`/`fromOptions`/`toOptions`
    logic; render `<DateS date={from} /> – <DateS date={to} />` (full pref date,
    incl. year — matches the approved preview `01/07/2026 – 22/07/2026`). Keep the
    `· N days` count.
  - `compliance-hero.tsx:54`: `const fmt = (d: Date) => formatDate(d);` (no options).
  - `timeframe.ts formatDateShort`: drop `month:"short", day:"numeric", year:"numeric"`;
    keep `localeOnly:true`; call `formatDate(date, prefs, { localeOnly: true })` →
    numeric per pref for the **custom-range** label. Leave `formatMonthLabel`
    (`month:"long"`) untouched (English header, per decision).

- [ ] **Step 4: Run the test, expect PASS.** `pkill -f vitest`.

- [ ] **Step 5: Commit** `fix(reports): render report data dates in the user's format`

---

### Task 3: Asset-Activity "Date & Time" column shows the time

**Files:**

- Modify: `apps/webapp/app/components/reports/asset-activity-content.tsx` (~92–94)

**Interfaces:** Consumes `DateCell`'s new `includeTime` (Task 2).

- [ ] **Step 1** — In the activity table's date column cell, pass `includeTime`:
      `cell: ({ row }) => <DateCell date={row.original.occurredAt} includeTime />` (match
      the column's actual accessor). Confirm the column header reads "Date & Time".
- [ ] **Step 2** — Manual/targeted check: the activity column now shows date+time in
      the user's format. If a test file exists for this content, extend it; else skip
      (covered by Task 2's `DateCell` test + Task 7 regression).
- [ ] **Step 3: Commit** `fix(reports): show time in the asset-activity Date & Time column`

---

### Task 4: Reports CSV export → display mode (per prefs)

**Files:**

- Modify: `apps/webapp/app/routes/_layout+/reports.export.$fileName[.csv].tsx`
  (`formatDateForCsv` ~422 + all generator call sites)

**Interfaces:**

- Consumes: `formatPrefs` (already resolved at ~107) + `formatDate`.
- Produces: `formatDateForCsv(date, prefs, opts?: { includeTime?: boolean })`.

- [ ] **Step 1** — Change the helper to prefs-aware display mode:

```ts
/** Format a date for CSV in the user's display format (per prefs). Returns "" for
 *  null. `includeTime` appends the time part for datetime columns. */
function formatDateForCsv(
  date: Date | null,
  prefs: ResolvedFormatPrefs,
  opts?: { includeTime?: boolean }
): string {
  if (!date) return "";
  return formatDate(date, prefs, { includeTime: opts?.includeTime });
}
```

- [ ] **Step 2** — Thread `prefs` (the already-fetched `formatPrefs`) into every
      generator function that calls `formatDateForCsv`, and pass `{ includeTime: true }`
      for **datetime** columns: `scheduledStart`, `scheduledEnd` (~310–311, 446),
      `occurredAt` (~617), `assignedAt` (~339). Leave date-only columns
      (`createdAt` ~567, `lastBookedAt` ~473) without `includeTime`.
- [ ] **Step 3** — CSV-safety: `formatDate` output for some prefs contains no comma
      (numeric `/` and `-`), but month-name prefs produce `"Jul 6, 2026"` — a comma
      that breaks CSV columns. Wrap the returned field in quotes if it contains a
      comma (or always quote date cells). Add this in `formatDateForCsv`.
- [ ] **Step 4** — Targeted test (create
      `reports.export.$fileName[.csv].test.ts` or extend the sibling) asserting a
      `MMM_DD_YYYY` date cell is quoted and a `DD_MM_YYYY` cell is `06/07/2026`.
      Run it; `pkill -f vitest`.
- [ ] **Step 5: Commit** `fix(reports): export CSV dates in the user's display format`

---

### Task 5: Chart-axis timezone consistency (low; English kept)

**Files:**

- Modify: `apps/webapp/app/modules/reports/helpers.server.ts` (~774–801, 3339–3343)

Chart tick labels stay English NAMES (decision). The only fix here is internal
consistency: day/week labels use server-local getters while month uses UTC. Make
day/week labels resolve in UTC too (keep `toLocaleDateString("en-US", …)` names)
so all axis ticks derive from the same zone. No user-format change.

- [ ] **Step 1** — Switch the day/week label getters to UTC-based (e.g.
      `toLocaleDateString("en-US", { weekday:"short", timeZone:"UTC" })`), matching the
      month path. Leave the English names.
- [ ] **Step 2** — If a helpers test exists, extend; else this is covered visually.
- [ ] **Step 3: Commit** `fix(reports): make chart-axis label timezone consistent`

---

### Task 6: Remove dead `parseTimeframeFromParams`

**Files:**

- Modify: `apps/webapp/app/modules/reports/timeframe.ts` (~200–216)

- [ ] **Step 1** — Confirm no references:
      `grep -rn "parseTimeframeFromParams" apps/webapp/app` → only its definition.
- [ ] **Step 2** — Delete the function (it would emit US-default labels if reused,
      and bypasses pref-tz). If any reference exists, replace with the loader's inline
      `resolveTimeframe(preset, from, to, prefs)` pattern instead.
- [ ] **Step 3: Commit** `chore(reports): remove dead parseTimeframeFromParams`

---

### Task 7: Regression test — DD/MM + Asia/Tokyo end-to-end

**Files:**

- Test: `apps/webapp/app/modules/reports/timeframe.test.ts` (or a new
  `reports-date-consistency.test.ts`)

- [ ] **Step 1** — Assert for `{ dateFormat:"DD_MM_YYYY", timeZone:"Asia/Tokyo" }`:
  - `resolveTimeframe("this_month", …, tokyo).from` is Tokyo month-start (Task 1).
  - the custom-range label (`formatDateShort` path) renders `dd/MM/yyyy` numeric.
  - `formatDateForCsv(date, tokyoPrefs)` renders `dd/MM/yyyy` (Task 4).
- [ ] **Step 2** — Run the file; `pkill -f vitest`.
- [ ] **Step 3: Commit** `test(reports): DD/MM + Tokyo date-consistency regression`

---

## Self-Review Notes

- **Kept-English surfaces are intentional** (`formatMonthLabel`, chart axes) — do
  NOT "fix" them; a reviewer seeing them unchanged is correct.
- Type names used consistently: `ResolvedFormatPrefs`, `ResolvedTimeframe`,
  `DateFormatOptions`.
- `DateCell.includeTime` defined in Task 2, consumed in Task 3 — names match.
- No full-suite runs anywhere; every task runs one targeted file.
