# PRD — Asset-Index PDF Export (v0.1)

| Field | Value |
|---|---|
| Status | Draft for CTO review |
| Author | Nikolay Bonev |
| Capability | Export the current asset-index selection as a workspace-branded PDF that mirrors the user's chosen columns, order, filters, and selection |
| Delivery model | `/goal`-driven, tests-first, infra-reuse-first |
| Architecture facts | `~/ShelfDev/shelf-architecture.json` (mechanically-extracted, self-verifying) |
| **Asymmetry vs Asset Image History PRD** | This is a **read-only render-side** feature. **Suite B (DB-semantic) is empty.** No dependency on the harness PR (PR-0). The feature `/goal` PR is honestly pristine end-to-end. |

---

## 1. What ships in v1

A "**Export PDF**" peer to the existing CSV export on the asset index. Same selection semantics (filter, sort, visible columns, select-across-all-pages). Output is a printable React view rendered via `react-to-print` — visually consistent with `booking-overview-pdf.tsx`. Honors the user's existing `AssetIndexSettings` (columns, order, `showAssetImage`). Tier-gated on `canExportAssets` (same as CSV). Workspace-branded header. Asset thumbnails per row by default, toggleable at export.

Nothing else.

## 2. What does NOT ship in v1

Explicit non-goals. Each is re-addable on signal.

- A new server-side PDF library (the repo uses `react-to-print` client-side; we do not introduce `@react-pdf/renderer`, `pdfkit`, Puppeteer, or any server PDF dependency)
- Inline column picker at export time (use `AssetIndexSettings` verbatim — see §3 principle and §14 Q1)
- New tier flag for PDF (reuse `canExportAssets`)
- Per-tier PDF feature differences (e.g. branded PDF vs basic PDF)
- Email-the-PDF / send-to-recipient / scheduled exports
- Custom cover page / TOC / executive summary
- Multi-page header customization (workspace logo, address, etc. beyond what `booking-overview-pdf.tsx` already does)
- Page-size / orientation picker (we default to a sensible choice — see §6.0 — and add later only on signal)
- PDF for kit detail, location detail, custody view (different surfaces; same primitive can extend later)
- Locked-content gating (this is an *export* the user explicitly invokes; there is no Crisp-pattern surface here)

## 3. Design principles

These are the default tie-breakers. §14 open questions may override a specific outcome.

1. **Build a primitive, not a "pull list" feature.** The customer demo was a pull list. The capability is *"export the current asset-index view as a PDF."* Same primitive serves pull list, audit prep, insurance documentation, location handover, vendor request, board reporting, lender inventory. Do not name, scope, or surface anything pull-list-specific.
2. **The user's current view IS the spec of the PDF.** Filters, sort, visible columns, column order, `showAssetImage` — whatever the user has set on their asset index is what the PDF renders. Forces zero new mental model. No picker, no second source of truth.
3. **Cut-first.** Anything not surviving Musk's algorithm (less-dumb → delete → simplify → accelerate → automate) is out of v1.
4. **Reuse before invention.** This PRD is almost entirely composition — see §9. New code is the printable component, the export action, the tier-gated server loader, and the action button. Nothing else.
5. **Tests are the machine-verifiable contract — not the whole contract.** §6 is what `/goal` can verify. §7 PR-2 items are equally binding but human-verified. An under-specified test is a spec gap to close, never a silent narrowing.

## 4. Execution model — `/goal`-driven, tests-first, infra-reuse-first

### 4.1 The load-bearing truth about `/goal`

`/goal` verifies conformance to the committed test suite from the transcript only — it does **not** verify the suite is adequate. The suite is therefore a CTO-reviewed *input gate* (§4.2), not a loop output. A model under "make tests green" pressure will, if the suite allows, weaken/skip/tautologise. The suite must be designed so the cheapest way to satisfy it is to actually implement the feature.

### 4.2 Test adequacy gate (precedes the loop)

The Vitest + RTL suite is committed as commit 1, then approved by CTO/reviewing agent against §6.0 interfaces and §6.1 assertions before `/goal` is set. Criteria:

- Every Suite A (§6.1) row has ≥1 test whose assertion is the *behavioral* claim, not a structural proxy.
- Each test fails for the right reason on `main` (red-first proof pasted in PR before any implementation commit).
- No `.skip` / `.only` / `.todo`. `BASELINE_ASSERTIONS` recorded as the floor.
- Suite A includes a **loader-wiring** test that drives the real loader with mocked `getAsset` / `getOrganizationTierLimit` to prove the wiring without a real DB.
- **Safari print-CSS** is a known browser-rendering risk and gets its own explicit assertion (test A7) on the print-CSS media query and page-break classes — not a "test in browser later" promise.

### 4.3 Pipeline

1. Commit 1 = full suite, all red. Red run pasted in PR.
2. §4.2 gate passes; suite is frozen contract.
3. `/goal` set (§5), auto mode on, loop runs unattended.
4. Terminates on full pass + anti-constraints. Turn-80 stop with anything red is a failure for human review, never completion.

### 4.4 Verifiable vs not

Two axes of un-verifiable, handled differently:
- **Subjective** UX/visual polish (final font hierarchy, exact margins, workspace-logo positioning nuance) → **PR-2**, human-driven (§7).
- **DB-semantic** invariants → **NONE in this feature.** This is a read-only render feature; no new mutations, no new transactions, no new constraints. Suite B (§6.2) is empty by design.

### 4.5 What the loop reads

`/goal` is pointed at the machine-facing contract only: **§5, §6.0, §6.1, §9**. Sections §1–§3 and §10–§15 are CTO/human context and are excluded from the loop's working set.

### 4.6 Property-nature split — why this PRD is faster than the last one

Asset Image History was a data-integrity feature, so its core invariants (atomicity, partial uniqueness, cascade) lived in PostgreSQL and *could not* be honestly verified by Shelf's 100%-mocked Prisma harness — forcing a dependency on the CTO-owned harness PR (PR-0).

Asset-Index PDF Export is the opposite: every assertion is either a pure function (rows + columns + options → printable shape) or a render assertion (RTL on the printable component). The mocked harness verifies all of it honestly. **PR-0 is not a dependency.** The cycle-time win is real — flag it to the CTO at scoping so the harness PR doesn't get bundled in by reflex.

## 5. The goal condition (v1 contract)

Set only after §4.2 passes. Anti-gaming clauses prove themselves via literal command output pasted into the transcript on the final turn (the evaluator cannot run tools).

```
/goal The branch satisfies ALL of the following, with the literal command
output for each pasted into the transcript on the final turn:

(1) `pnpm webapp:test -- --run apps/webapp/app/components/assets/assets-index/export-assets-pdf.test.tsx
     apps/webapp/app/routes/_layout+/assets.export.$fileName.pdf.test.ts`
    exits 0; summary shows zero failed, zero skipped, zero todo; passing-
    assertion count >= BASELINE_ASSERTIONS recorded at §4.2 (paste summary);
(2) `pnpm webapp:lint` exits 0 and `pnpm turbo typecheck` exits 0 (paste both);
(3) `pnpm --filter @shelf/database exec prisma validate` exits 0 (paste it).
    No schema changes are expected — this feature is schema-neutral; if the
    diff includes ANY change under packages/database/prisma/, HALT for human
    review (read-only feature, no migration intended);
(4) coverage of net-new lines in the new printable component + new export
    route is >= 90% (paste coverage table rows);
(5) `git diff --stat main...HEAD` shows: no test file outside the two named
    above modified; the two test files have only ADDED lines vs commit-1
    (no deletions/edits to committed assertions); no new dependency in
    package.json (we do NOT add a server PDF library — react-to-print is
    already in the repo); (paste the stat);
(6) `grep -rn "TODO\|FIXME\|\.skip(\|\.only(\|expect(true)" <net-new files>`
    returns nothing (paste empty result);
(7) `git log --oneline main...HEAD` shows test commit is FIRST and precedes
    all implementation commits (paste it);
(8) net-new TypeScript lines per `git diff --stat` is reported each turn;
    if it exceeds 500, HALT and emit "LINE-BUDGET EXCEEDED, NEEDS HUMAN
    REVIEW" (this feature is composition-heavy — a >500-line diff means
    something is being reinvented instead of reused; the right answer is
    human triage, not minification);
or stop after 60 turns and emit "TURN-LIMIT FAILURE".
```

Notes on what's deliberately *different* from the Asset Image History `/goal`:
- 500-line budget (not 800) — much smaller feature surface; >500 LOC means the reuse map is being ignored.
- 60-turn cap (not 80) — fewer DB-semantic complexities to wrestle.
- `prisma validate` is run but a non-empty schema diff is itself a HALT (this feature must not change the schema).

## 6. Behavior contract — the test groups

### 6.0 Interfaces under test

```ts
// apps/webapp/app/components/assets/assets-index/export-assets-pdf.tsx
// Pure printable component. No data fetching inside. Receives everything
// it needs as props so it is trivially RTL-testable.

export type PdfColumn = {
  name: string;          // matches AssetIndexSettings.columns entry
  position: number;
  label: string;         // human-rendered header
};

export type PdfAssetRow = {
  id: string;
  values: Record<string, string | number | null>;  // keyed by column name
  thumbnailUrl: string | null;                     // resolved server-side
};

export type AssetIndexPdfProps = {
  branding: { workspaceName: string; workspaceLogoUrl: string | null };
  generatedAt: Date;
  generatedBy: { displayName: string };
  filterSummary: string;                           // e.g. "Location: Warehouse 1 · Tag: drill"
  columns: PdfColumn[];                            // already filtered to visible, sorted by position
  rows: PdfAssetRow[];
  includeImages: boolean;                          // toggle at export
  totalRowCount: number;                           // for the footer count + truncation note
};

export function AssetIndexPdf(props: AssetIndexPdfProps): JSX.Element;

// The action button + dialog (RTL-testable, no data fetching here either)
export function ExportAssetsPdfButton(props: {
  disabled: boolean;
  initialIncludeImages: boolean;     // defaults to AssetIndexSettings.showAssetImage
}): JSX.Element;

// Server loader for the export route — Suite A wires against this with
// `getAsset*` and `getOrganizationTierLimit` mocked.
export async function loader(args: LoaderFunctionArgs): Promise<{
  asset: never;  // route returns rendered HTML, not JSON; type kept for parity
}>;
```

### 6.1 Suite A — the entire `/goal` scope

`apps/webapp/app/components/assets/assets-index/export-assets-pdf.test.tsx` +
`apps/webapp/app/routes/_layout+/assets.export.$fileName.pdf.test.ts`.

| # | Test group | Assertion | Pulls into existence |
|---|---|---|---|
| A0 | Loader-wiring | With `getOrganizationTierLimit` mocked to `{canExportAssets:false}`, the loader returns a 403 (or the existing `ShelfError` shape); with `{canExportAssets:true}` it returns rendered HTML containing the workspace name; `getAssetsWhereInput` is called with the request's `currentSearchParams` (proves filter round-trip) | Server loader at `routes/_layout+/assets.export.$fileName.pdf.tsx` reuses existing select-all/filter pattern; tier-gated identically to CSV |
| A1 | Column order honors `AssetIndexSettings` | RTL render with `columns` in non-sequential `position` order → DOM column order matches `position`-sorted; hidden columns (visible=false) do not appear | `AssetIndexPdf` reads `columns` verbatim, filters & sorts by position |
| A2 | Custom-field columns render | `columns` containing dynamic custom-field entries renders their `label` headers and values from `row.values[name]` | `AssetIndexPdf` is column-name-agnostic — pure mapping |
| A3 | Thumbnails default to `showAssetImage` | `ExportAssetsPdfButton` mounted with `initialIncludeImages={false}` shows the checkbox unchecked; with `true`, checked | Toggle wired to the user's existing index pref |
| A4 | Thumbnails included iff `includeImages=true` | RTL render: with `includeImages:true` + rows having `thumbnailUrl`, an `<img>` (or `<AssetImage>`) appears per row; with `includeImages:false`, zero `<img>` in the printable view | Conditional render branch |
| A5 | Filter summary line surfaces filters | A row with applied filters renders a human-readable filter line in the header; with no filters, the line is empty | Filter-summary helper (pure) |
| A6 | Footer shows generation metadata | Footer contains `generatedAt` (formatted via existing `DateS`), `generatedBy.displayName`, and `totalRowCount` | Footer pure render |
| A7 | Print-CSS + page breaks | The printable view has `@media print` styles applied; rows have a `page-break-inside: avoid` class; the header repeats per page (`thead.repeat-on-print` or equivalent). Asserted on the resolved computed styles via `window.matchMedia` + jsdom/happy-dom checks; **AND** a Playwright/manual checklist item exists in PR-2 to confirm the same in real Safari | CSS module / Tailwind print utilities on the printable component |
| A8 | Large-selection truncation | When `totalRowCount > MAX_PDF_ROWS` (constant; see §14 Q2) the renderer truncates and shows a clear truncation banner naming the cap and inviting CSV for full export | Cap constant + truncation branch |
| A9 | Filename is sanitized | The download filename uses the existing `sanitizeFilename()` helper from `~/utils/sanitize-filename` (already used by audit PDF); contains workspace slug + ISO date | Filename builder pure fn |
| A10 | Permission gate at loader, not button | Even if the button is somehow rendered for a free user, hitting the route loader directly returns the same 403/ShelfError — the gate is server-side, never UI-only | `requirePermission({entity:asset, action:export})` at loader top |
| A11 | No new server PDF dependency | A static assertion test: importing the new files does not transitively import `@react-pdf/renderer`, `pdfkit`, `jspdf`, or any other server PDF lib. (Failsafe against drift) | Maintain the react-to-print-only architecture |

Net-new test count target: ~22 cases across 12 groups. Each test logs its id and outcome; the runner prints `Tests: N passed, 0 failed, 0 skipped` for the evaluator.

### 6.2 Suite B — empty

There are no DB-semantic invariants in this feature. The select-all/filter pattern (`ALL_SELECTED_KEY`, `isSelectingAllItems()`, `getAssetsWhereInput`, `takeAll:true`) is **already an existing pattern with existing tests** and is reused without modification. The new export route is a thin server-render shell over that pattern. **No PR-0 dependency.** Stated explicitly so the CTO does not bundle harness work into this PRD by reflex.

## 7. PR sequence

**PR-1 — the feature `/goal` PR (this PRD).** Honestly machine-verified by Suite A (§6.1). Ships:
- `apps/webapp/app/components/assets/assets-index/export-assets-pdf.tsx` (printable component, AssetIndexPdf + ExportAssetsPdfButton)
- `apps/webapp/app/routes/_layout+/assets.export.$fileName.pdf.tsx` (server loader: permission gate + tier gate + filter/select-all + row shaping for the component)
- Wire `<ExportAssetsPdfButton>` into the existing export menu next to the CSV button (the menu UI minimally extended, not redesigned)

**PR-2 — human-driven follow-up (not `/goal`-driven; out of scope here).** Subjective polish reviewed by CTO + designer:
- Final visual tuning of the printable layout (typography hierarchy, exact margins, brand placement)
- **Safari/WebKit print verification** with a concrete manual checklist (or a Playwright/WebKit screenshot smoke test) — A7 covers the print-CSS *application*; PR-2 covers does-it-actually-look-right in Safari
- Empty-state visual (zero rows match the filter)
- Decision on landscape vs portrait default if A4 paper-size leads to an obviously bad break

**PR-0 — NOT a dependency.** Suite B is empty. The harness PR remains valuable for the org but does not gate this feature.

## 8. Data model

**No schema changes.** The feature reads existing models (`AssetIndexSettings`, `Asset`, `Organization`, `TierLimit`/`CustomTierLimit`, `User`) and writes nothing. `prisma validate` runs in §5 clause (3) but a non-empty schema diff *halts* the loop — this PRD must not introduce a migration.

## 9. Reuse map — the feature is almost entirely composition

| Capability | Existing primitive |
|---|---|
| PDF rendering | `react-to-print` + printable React component pattern, lifted from `apps/webapp/app/components/booking/booking-overview-pdf.tsx` and `apps/webapp/app/components/audit/audit-receipt-pdf.tsx`. Both verified to use `useReactToPrint` + `<Dialog>` + printable view + visible-trigger button. We **do not introduce a server PDF library** |
| Asset-index column model | `AssetIndexSettings.columns` JSON: `[{name, visible, position}]` plus dynamic custom-field entries. Read verbatim |
| Existing per-user thumbnail toggle on the index | `AssetIndexSettings.showAssetImage` — used as the initial value for the export's "include thumbnails" checkbox |
| Select-all-across-pages + filter round-trip | The existing pattern documented in `CLAUDE.md` "Bulk Operations & Select All": `ALL_SELECTED_KEY`, `isSelectingAllItems()`, `currentSearchParams`, `getAssetsWhereInput({organizationId, currentSearchParams})`, `takeAll:true`. Already used by `export-assets-button.tsx` (94 lines) — the new PDF button mirrors it |
| Tier limit read | `getOrganizationTierLimit({ organizationId, organizations })` (`apps/webapp/app/modules/tier/service.server.ts:107`), returns `TierLimit \| CustomTierLimit`; `canExportAssets` already exists on both (schema:851). No new flag |
| Permission gate | `requirePermission({ userId, request, entity:asset, action:export })` (`apps/webapp/app/utils/roles.server.ts:48`) — same pattern as CSV |
| Asset thumbnail rendering | `<AssetImage>` (`apps/webapp/app/components/assets/asset-image/component.tsx`) — handles signed-URL refresh and fallback. Same component the booking PDF uses |
| Date formatting | `<DateS>` (existing, mandated by CLAUDE.md) |
| Filename sanitation | `sanitizeFilename()` from `~/utils/sanitize-filename` (used by audit PDF) |
| User display name | `resolveUserDisplayName()` (used by both existing PDFs) |
| Dialog UI | `<Dialog>` / `<DialogPortal>` (used by both existing PDFs) |
| Existing CSV export route as routing precedent | `apps/webapp/app/routes/_layout+/assets.export.$fileName[.csv].tsx` — model the PDF route on this filename + scoping |

Net-new code v1 must produce — that's it:

- `AssetIndexPdf` printable component (the layout)
- `ExportAssetsPdfButton` action button + dialog (wraps `useReactToPrint`)
- Server loader at `assets.export.$fileName.pdf.tsx` (tier gate + select-all/filter + row shaping)
- A small filter-summary helper (pure, named, testable)
- A small filename builder (pure, named, testable)
- Minimal wiring into the existing export menu

Everything else is composition.

## 10. Cost — negligible

The feature is client-side print rendering. **No new server compute, no new storage, no new dependencies, no new infra.** The only marginal cost is the bandwidth to ship the printable component's JS to the browser (it lazy-loads; ~few KB gzipped given how much is reused). Egress for thumbnails is the same as on the index page. No cost model needed.

## 11. Risk register — ship blockers only

| # | Risk | Mitigation | v1 status |
|---|---|---|---|
| 1 | **Safari print rendering** diverges from Chrome (memory: shelf.nu jank lives in Safari) | A7 asserts the print CSS is *applied*; PR-2 carries the manual Safari checklist (or WebKit smoke test) to verify it *renders right* | ⚠️ Split: applied=A7, renders-right=PR-2 |
| 2 | **Huge selection (select-all across thousands)** crashes the print dialog or the browser | Hard cap `MAX_PDF_ROWS` (see §14 Q2); A8 asserts truncation behavior + truncation banner naming the cap and pointing to CSV. The cap is a constant in code, not configurable | ✅ |
| 3 | Tier gate enforced only in UI (button hidden) and bypassable by hitting the route URL directly | A10 asserts loader returns 403 regardless of UI state | ✅ |
| 4 | Server PDF dependency drift (someone adds `@react-pdf/renderer` later "to make it nicer") | A11 static-imports assertion fails if any server PDF library appears in the dependency graph of the new files | ✅ |
| 5 | Schema drift via this PRD (an "improvement" tacks on a column to `AssetIndexSettings`) | §5 clause (3) HALTs on any `packages/database/prisma/` diff; this PRD must not mutate schema | ✅ |
| 6 | Custom-field columns rendered without proper escaping → HTML injection in the printable view | The printable React component renders values via JSX text children (React auto-escapes); A2 asserts headers and values from custom fields render verbatim; a single test asserts a malicious string in a custom-field value renders as text, not HTML | ✅ (add to A2 as a sub-assertion) |

Notably absent (would be ship-blockers in a different feature, not this one): GDPR cascade, atomicity, partial-index races, signed-URL leaks to free tier (none of those apply to a tier-gated explicit user-invoked export).

## 12. Rollout

| Phase | Description | Exit criterion |
|---|---|---|
| 1 | Ship behind feature flag `enableAssetIndexPdfExport` OFF | Suite A green; CI clean |
| 2 | Enable for Shelf team workspace + Carlos's GBP workspace | One week without print-rendering or selection-cap incidents |
| 3 | **WebKit pass** (PR-2 closes; Safari render confirmed visually correct) | Designer + CTO sign-off |
| 4 | Flag ON for all orgs with `canExportAssets=true` (i.e. same audience as CSV export) | Funnel events emit; A/B not required (parity feature) |

## 13. Success metrics

Minimal funnel; this is a parity feature, not a conversion lever.

```
asset_pdf_export_button_clicked   { workspace_id, plan, selected_count, include_images }
asset_pdf_export_completed        { workspace_id, plan, row_count, include_images, hit_cap }
asset_pdf_export_truncated        { workspace_id, plan, requested_count, cap }
```

Useful tells: ratio of `truncated:completed` → cap may be too low; `include_images` true-rate → confirms the default tracks user intent.

## 14. Open questions — actual blockers only

1. **Reaffirm: columns from `AssetIndexSettings` verbatim, no inline picker.** Confirmed in scoping; locked unless objection in CTO review.
2. **`MAX_PDF_ROWS` cap value.** Suggestion: **500**. Rationale: ~500 rows with thumbnails is the soft ceiling where browser print stays performant on a mid-range laptop; CSV remains the answer above that. Open to a different number if you have data. The cap is a code constant, not configurable per workspace in v1.
3. **Page orientation default.** Suggestion: **landscape**. The asset index is column-heavy; most user views will not fit portrait. Booking PDF uses portrait but it has a different shape. Confirm or flip.
4. **Server-rendered vs purely client-rendered.** Both existing PDFs (`booking-overview-pdf.tsx`, `audit-receipt-pdf.tsx`) are *client-rendered* React components triggered by `useReactToPrint`. We follow that. The server loader's job is *data preparation*, not rendering. Confirm this is the intended architecture (mirrors precedent; no reason to deviate).

## 15. Appendix

### 15.1 Architecture map

`~/ShelfDev/shelf-architecture.json` — the mechanically-extracted, self-verifying whole-app context. The reuse map in §9 is grounded against this artifact (not LLM lore).

### 15.2 Why the property-nature split makes this feature cheap

The Asset Image History PRD (v0.8) had to declare a hard dependency on a CTO-owned real-DB test harness (PR-0) because its core invariants — transaction atomicity, partial unique index, `onDelete: Cascade` — live in PostgreSQL and cannot be honestly verified against Shelf's 100%-mocked Prisma harness. That PRD's Suite B is large.

This PRD has the inverse profile. Every assertion is either:
- A pure function (rows + columns + options → printable shape), or
- A render assertion (RTL on the printable component), or
- A loader-wiring assertion (mocked `getAsset` and `getOrganizationTierLimit`).

The mocked harness verifies all of it honestly. The reuse map carries most of the implementation. The schema doesn't change. There is no new dependency. There is no Crisp-style visibility gate, no GDPR cascade, no signed-URL leak concern, no Stripe webhook coupling.

**Net result: a single feature `/goal` PR with no harness dependency, an honest "pristine" outcome, and a tight cycle time.** That is the dividend of having done the verification-by-property-nature thinking once on the harder feature.

### 15.3 Decisions log

| Decision | Resolution | Reason |
|---|---|---|
| PDF library | `react-to-print` (existing, client-side); no server PDF lib added | Two existing PDFs (booking, audit) use it; CLAUDE.md "Reuse before invention" |
| Tier gate | `canExportAssets` (existing) | One concept; matches CSV |
| Columns | `AssetIndexSettings.columns` verbatim, no inline picker | User's existing setup time IS the spec |
| Thumbnail default | `AssetIndexSettings.showAssetImage` (existing per-user pref) | One mental model across index + export |
| Schema | **Unchanged** (`prisma validate` HALT on any diff) | Read-only feature |
| Suite B | **Empty** | No new DB-semantic invariants |
| PR-0 harness | **Not a dependency** for this feature | Pure-logic + render-side only |
| Line budget | 500 (vs 800 in last PRD) | Smaller feature surface; reuse-heavy |
| Turn cap | 60 (vs 80) | Fewer unknowns to wrestle |
| Pull-list naming | Rejected | "Pull list" is one customer use case; primitive is "PDF export of asset selection" |

---

*v0.1 of a property-nature-aware, reuse-first, harness-independent feature PRD. The §4.2 adequacy gate is the single human checkpoint before `/goal` is set. Open questions §14 are scoping confirmations; risk #1's Safari rendering is the one quality-pass gate before general release.*
