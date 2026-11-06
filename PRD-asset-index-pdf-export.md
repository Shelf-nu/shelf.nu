# PRD — Asset-Index PDF Export (v0.5, §4.2-adversarial-pass)

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

- Every Suite A (§6.1) row has ≥1 test whose assertion is the *behavioral* claim, not a structural proxy. **Security-class tests (e.g. A12 cross-org IDOR) MUST be behavioral** — asserting "the IDOR is excluded from output", not "the call was made with the right arg". A structural-proxy security test is worse than no test (it manufactures false confidence) — see §4.6.
- Each test fails for the right reason on `main` (red-first proof pasted in PR before any implementation commit). A test that fails due to a missing fixture / unspecified accessible-name / fragile path is failing for the *wrong* reason and burns `/goal` turns chasing it.
- No `.skip` / `.only` / `.todo`. `BASELINE_ASSERTIONS` recorded as the floor.
- Suite A includes a **loader-wiring** test that drives the real loader with mocked `getAsset` / `getOrganizationTierLimit` to prove the wiring without a real DB.
- **Safari print-CSS** is a known browser-rendering risk and gets its own explicit assertion (test A7) on the print-CSS media query and page-break classes — not a "test in browser later" promise.
- **Reviewer ≠ author.** The agent / human running the §4.2 gate MUST NOT be the one who wrote the test suite. Self-review is structurally compromised; an author will rationalise their own omissions, tautologies, and proxies. If only the author is available, the gate must be run twice — once by the author (red-team mode, adversarial pass), then again by an independent agent or human before `/goal` is set. Added 2026-05-20 after the v0.4.1 gate review surfaced author-blindspot findings (#1 A12 structural-proxy, #2 wrong-reason fails) that a clean second pass caught.

### 4.3 Pipeline

1. Commit 1 = full suite, all red. Red run pasted in PR.
2. §4.2 gate passes; suite is frozen contract.
3. `/goal` set (§5), auto mode on, loop runs unattended.
4. Terminates on full pass + anti-constraints. **A turn-60 stop with anything red is a failure for human review, never completion** (the cap is set in §5; this PRD uses 60, smaller than the image-history PRD's 80, since this feature has fewer unknowns).

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

```text
/goal The branch satisfies ALL of the following, with the literal command
output for each pasted into the transcript on the final turn:

(1) `pnpm webapp:test -- --run apps/webapp/app/components/assets/assets-index/export-assets-pdf.test.tsx
     apps/webapp/test/routes-tests/asset-index-pdf-export.test.ts`
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
    above modified; no new dependency in package.json (we do NOT add a
    server PDF library, react-to-print is already in the repo) (paste the
    stat). Separately, to catch assertions weakened AFTER the freeze (a
    three-dot `main...HEAD` diff cannot detect this, since the test files
    are net-new and always render as all-additions vs the merge-base), run
    `git diff --numstat <COMMIT_1_SHA>..HEAD --
    apps/webapp/app/components/assets/assets-index/export-assets-pdf.test.tsx
    apps/webapp/test/routes-tests/asset-index-pdf-export.test.ts` and confirm
    the deletions column is 0 for both files (no edits or deletions to
    committed assertions vs the recorded commit-1; record COMMIT_1_SHA at
    §4.2 when the suite is frozen) (paste the numstat);
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
  columns: PdfColumn[];                            // PRE-FILTERED + PRE-SORTED by
                                                   // selectVisibleColumns(); the component
                                                   // does NOT re-filter or re-sort —
                                                   // that ownership belongs to the helper
                                                   // below, where test A1 lives
  rows: PdfAssetRow[];
  includeImages: boolean;                          // toggle at export
  totalRowCount: number;                           // for the footer count (no truncation in v0.4 — see §14 Q2)
};

export function AssetIndexPdf(props: AssetIndexPdfProps): JSX.Element;

// Pure helper invoked by the LOADER (not the component) that turns the
// AssetIndexSettings.columns JSON (entries with visible:false and arbitrary
// position) into the component-ready list. This is where the
// filter+sort ownership lives and where test A1 asserts behavior.
export type RawColumnEntry = {
  name: string; visible: boolean; position: number; label: string;
};
export function selectVisibleColumns(raw: RawColumnEntry[]): PdfColumn[];

// The action button + dialog (RTL-testable, no data fetching here either).
//
// PINNED CONTRACT (per §4.2 "red-for-right-reason" criterion): the
// "Include thumbnails" checkbox's accessible name MUST be exactly the
// string "Include thumbnails" — no localisation indirection in v1, no
// "Include images" / "Add asset photos" variants. Locked here so the
// A3 test asserts the exact string instead of fuzzy regex.
export function ExportAssetsPdfButton(props: {
  disabled: boolean;
  initialIncludeImages: boolean;     // defaults to AssetIndexSettings.showAssetImage
}): JSX.Element;

// Server loader for the export route — Suite A wires against this with
// `getAsset*` and `getOrganizationTierLimit` mocked. Returns a rendered
// HTML Response (the printable view as a self-contained document); the
// browser-side react-to-print triggers from that page. NOT JSON.
export async function loader(args: LoaderFunctionArgs): Promise<Response>;
```

The `selectVisibleColumns()` / `AssetIndexPdf` split is deliberate: filtering+sorting is a loader-layer concern, rendering is a component-layer concern, and tests A1 (helper) and A1b (component render order) verify each cleanly without overlap or tautology.

### 6.1 Suite A — the entire `/goal` scope

`apps/webapp/app/components/assets/assets-index/export-assets-pdf.test.tsx` +
`apps/webapp/test/routes-tests/asset-index-pdf-export.test.ts`.

| # | Test group | Assertion | Pulls into existence |
|---|---|---|---|
| A0 | Loader-wiring | With `getOrganizationTierLimit` mocked to `{canExportAssets:false}`, the loader returns a 403 (or the existing `ShelfError` shape); with `{canExportAssets:true}` it returns a `Response` containing rendered HTML with the workspace name; `getAssetsWhereInput` is called with the request's `currentSearchParams` (proves filter round-trip) | Server loader at `routes/_layout+/assets.export.$fileName[.pdf].tsx` reuses existing select-all/filter pattern; tier-gated identically to CSV |
| A1 | `selectVisibleColumns()` filter + sort | Given a `RawColumnEntry[]` mix containing `visible:false` entries and non-sequential `position` values, the helper returns only `visible:true` entries sorted by `position` ascending. Pure fn, no React, no DB | `selectVisibleColumns()` helper (loader-layer) |
| A1b | Component renders columns in input order, no reordering | RTL render of `AssetIndexPdf` with `columns: [{c, 0}, {a, 1}, {b, 2}]` → DOM column order is exactly `c, a, b`. Asserts the component takes its input as authoritative (no implicit re-filter/re-sort) — complements A1 cleanly so filter-ownership lives in one place | `AssetIndexPdf` renders headers/cells in input column order |
| A2 | Custom-field columns render | `columns` containing dynamic custom-field entries renders their `label` headers and values from `row.values[name]`. **Sub-assertion:** a malicious string in a custom-field value renders as text, not HTML (React auto-escapes; explicit guard against future regression) | `AssetIndexPdf` is column-name-agnostic — pure mapping |
| A3 | Thumbnails default to `showAssetImage` | `ExportAssetsPdfButton` mounted with `initialIncludeImages={false}` shows the checkbox unchecked; with `true`, checked | Toggle wired to the user's existing index pref |
| A4 | Thumbnails included iff `includeImages=true` | RTL render: with `includeImages:true` + rows having `thumbnailUrl`, an `<img>` (or `<AssetImage>`) appears per row; with `includeImages:false`, zero `<img>` in the printable view | Conditional render branch |
| A5 | Filter summary line surfaces filters | A row with applied filters renders a human-readable filter line in the header; with no filters, the line is empty | Filter-summary helper (pure) |
| A6 | Footer shows generation metadata | Footer contains `generatedAt` (formatted via existing `DateS`), `generatedBy.displayName`, and `totalRowCount` | Footer pure render |
| A7 | Print-CSS + page-break structure | The printable view (a) has a `@media print` rule registered, (b) wraps rows in a container element carrying `page-break-inside: avoid` (Tailwind `break-inside-avoid` or equivalent class on each row), and (c) **uses a native `<thead>` element**, so headers repeat per print page via the browser's built-in `display: table-header-group` default — **no custom `.repeat-on-print` class is introduced**. Asserted via DOM structure (presence of `<thead>`, presence of the break-avoid class) in happy-dom; the actual visual repeat across multiple printed pages in real Safari + Chrome is verified manually in the PR-2 checklist (jsdom cannot simulate browser print pagination) | Tailwind print utilities + native `<thead>` element on the printable component |
| ~~A8~~ | ~~Large-selection truncation~~ | **REMOVED in v0.4.** Per §14 Q2 resolution: existing `booking-overview-pdf.tsx` and `audit-receipt-pdf.tsx` do NOT cap row count (verified by grep — no `MAX`/`limit`/`truncate` in either). This PRD invented a cap that breaks pattern consistency. Per Nikolay: *"If we generate the PDF in the same manner we do in the other places, I don't see a reason to do this."* Mitigation for very large selections is the same as for the existing PDFs: the user's browser print dialog handles whatever they ask for; CSV remains the answer if they're hitting browser memory limits, but Shelf does not silently truncate | (nothing — removed) |
| A9 | Filename is sanitized | The download filename uses the existing `sanitizeFilename()` helper from `~/utils/sanitize-filename` (already used by audit PDF); contains workspace slug + ISO date | Filename builder pure fn |
| A10 | Permission gate at loader, not button | Even if the button is somehow rendered for a free user, hitting the route loader directly returns the same 403/ShelfError — the gate is server-side, never UI-only | `requirePermission({entity:asset, action:export})` at loader top |
| A11 | No new server PDF dependency | A static assertion test: importing the new files does not transitively import `@react-pdf/renderer`, `pdfkit`, `jspdf`, or any other server PDF lib. (Failsafe against drift) | Maintain the react-to-print-only architecture |
| **A12** | **Cross-org IDOR — selection from a different org is excluded** | Mock `requirePermission` to return `organizationId: "org-A"`. Seed the request's selection / `currentSearchParams` with an asset ID belonging to `org-B`. Hit the loader. Assert: (a) the PDF body contains zero rows referencing the org-B asset id, (b) `getAssetsWhereInput` was called with `organizationId: "org-A"` (the caller's org, not anything from the request payload), and (c) the response shape is the normal success shape (silent filter, not a 5xx — the existing `getAssetsWhereInput` pattern scopes by org, an attacker simply sees their own org's data) | Server loader relies exclusively on `getAssetsWhereInput({organizationId, currentSearchParams})` for the asset query; **never** trusts asset IDs from request input without org-scoping. This is the known Shelf bug class per `.claude/rules/org-scope-user-supplied-ids.md` (*"the original bug: edit validated, create did not"*); the read path here must not repeat it |

Net-new test count target: ~22 cases across 13 groups (v0.3 had 14 incl. A8 — A8 removed in v0.4 per §14 Q2). Each test logs its id and outcome; the runner prints `Tests: N passed, 0 failed, 0 skipped` for the evaluator.

### 6.2 Suite B — empty

There are no DB-semantic invariants in this feature. The select-all/filter pattern (`ALL_SELECTED_KEY`, `isSelectingAllItems()`, `getAssetsWhereInput`, `takeAll:true`) is **already an existing pattern with existing tests** and is reused without modification. The new export route is a thin server-render shell over that pattern. **No PR-0 dependency.** Stated explicitly so the CTO does not bundle harness work into this PRD by reflex.

## 7. PR sequence

**PR-1 — the feature `/goal` PR (this PRD).** Honestly machine-verified by Suite A (§6.1). Ships:
- `apps/webapp/app/components/assets/assets-index/export-assets-pdf.tsx` (printable component, AssetIndexPdf + ExportAssetsPdfButton)
- `apps/webapp/app/routes/_layout+/assets.export.$fileName[.pdf].tsx` (server loader: permission gate + tier gate + filter/select-all + row shaping for the component)
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
- Server loader at `assets.export.$fileName[.pdf].tsx` (tier gate + select-all/filter + row shaping)
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
| 2 | **Huge selection** stresses the browser print dialog | Match the existing PDF precedent — neither `booking-overview-pdf.tsx` nor `audit-receipt-pdf.tsx` cap row count, and we don't introduce one here (per §14 Q2). The browser's print dialog handles whatever the user asks for; CSV remains the answer for catastrophic sizes. If real-world data later shows browser crashes are common, revisit with telemetry from `selected_count` distribution (§13) | ✅ (matches precedent; no cap shipped) |
| 3 | Tier gate enforced only in UI (button hidden) and bypassable by hitting the route URL directly | A10 asserts loader returns 403 regardless of UI state | ✅ |
| 4 | Server PDF dependency drift (someone adds `@react-pdf/renderer` later "to make it nicer") | A11 static-imports assertion fails if any server PDF library appears in the dependency graph of the new files | ✅ |
| 5 | Schema drift via this PRD (an "improvement" tacks on a column to `AssetIndexSettings`) | §5 clause (3) HALTs on any `packages/database/prisma/` diff; this PRD must not mutate schema | ✅ |
| 6 | Custom-field columns rendered without proper escaping → HTML injection in the printable view | The printable React component renders values via JSX text children (React auto-escapes); A2 asserts headers and values from custom fields render verbatim; a single test asserts a malicious string in a custom-field value renders as text, not HTML | ✅ (add to A2 as a sub-assertion) |
| 7 | **Cross-org IDOR** via the selection / search-params: an attacker-supplied asset ID belonging to another org gets included in the PDF — a known Shelf bug class per `.claude/rules/org-scope-user-supplied-ids.md` ("the original bug: edit validated, create did not") | Server loader uses `getAssetsWhereInput({organizationId, currentSearchParams})` exclusively (no input asset IDs trusted unscoped). A12 asserts: a request supplying a foreign-org asset ID gets that asset silently filtered out (caller's-org-scoped query, not a 5xx) | ✅ (A12 added in v0.3) |

Notably absent (would be ship-blockers in a different feature, not this one): GDPR cascade, atomicity, partial-index races, signed-URL leaks to free tier (none of those apply to a tier-gated explicit user-invoked export).

## 12. Rollout

| Phase | Description | Exit criterion |
|---|---|---|
| 1 | Ship behind feature flag `enableAssetIndexPdfExport` OFF | Suite A green; CI clean |
| 2 | Enable for Shelf team workspace + Carlos's GBP workspace | One week without print-rendering incidents (no cap to incident on per §14 Q2) |
| 3 | **WebKit pass** (PR-2 closes; Safari render confirmed visually correct) | Designer + CTO sign-off |
| 4 | Flag ON for all orgs with `canExportAssets=true` (i.e. same audience as CSV export) | Funnel events emit; A/B not required (parity feature) |

## 13. Success metrics

Minimal funnel; this is a parity feature, not a conversion lever.

```text
asset_pdf_export_button_clicked   { workspace_id, plan, selected_count, include_images }
asset_pdf_export_completed        { workspace_id, plan, row_count, include_images }
```

(Removed in v0.4: `asset_pdf_export_truncated` and `hit_cap` field — there is no cap, per §14 Q2.)

Useful tells: `include_images` true-rate → confirms the default tracks user intent; `selected_count` distribution → if very large selections become common we may want to revisit the cap question with real data, but not pre-emptively.

## 14. Open questions — all resolved in v0.4

All four sealed via Nikolay's review comment on PR #2562 (2026-05-20).

1. **Columns from `AssetIndexSettings` verbatim, no inline picker.** ✅ **Confirmed.** Quoted: *"Yes for now I would make it consistent. If they want to print less columns they can be temp disabled in the column picker."*
2. **Row cap.** ✅ **Resolved: NO cap.** Nikolay pushed back: *"If we generate the PDF in the same manner we do in the other places, I don't see a reason to do this."* Verified by grep: `booking-overview-pdf.tsx` and `audit-receipt-pdf.tsx` have zero MAX/limit/truncate. v0.4 removes A8, `MAX_PDF_ROWS`, the truncated event, and updates risk #2.
3. **Page orientation default: landscape.** ✅ **Confirmed.** Quoted: *"Agreed."*
4. **Client-rendered react-to-print architecture.** ✅ **Confirmed.** Quoted: *"For now this is tried and tested so I would use it. If one day we decide to do something else, we can migrate all our pdf generation functionality."*

§14 is now closed. The §4.2 adequacy gate is the only remaining human checkpoint before `/goal` runs.

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

### 15.4 Review-pass-1 corrections (v0.1 → v0.2)

Applied 2026-05-20 from CodeRabbit + ChatGPT Codex automated review on PR #2562.

| Source | Severity | Finding | Resolution |
|---|---|---|---|
| Codex inline | P2 | Turn-cap mismatch: §4.3 said "Turn-80 stop" while §5 caps at 60. Same run could be classified pass/fail depending on which section was read | §4.3 now explicitly says **turn-60**, references §5 as the cap source, and notes the smaller cap vs the image-history PRD's 80 |
| Codex inline | P2 | A1 vs §6.0 internal contradiction: A1 asserted hidden columns are filtered, but §6.0 declared `columns` already pre-filtered at the component boundary — making A1 tautological or owning the wrong layer | Added pure helper `selectVisibleColumns()` in §6.0 as the loader-layer owner of filter+sort. A1 now tests this helper; new A1b tests the component renders input order verbatim. Clean SoC, no contradiction |
| CodeRabbit nitpick | Quick win | Test A7's `thead.repeat-on-print` was ambiguous (custom class or native?) | Decided: **native `<thead>`** (default `display: table-header-group` repeats on print). No custom class introduced. A7 reworded to assert presence of `<thead>` + break-avoid class in DOM; visual multi-page repeat verified in PR-2 manual checklist (jsdom can't simulate print pagination) |
| CodeRabbit nitpick | Quick win | §13 events code block missing language fence | Added `text` |
| CodeRabbit nitpick | Quick win | §5 `/goal` code block missing language fence | Added `text` |
| (bonus) | n/a | A2 custom-field XSS regression guard | Added sub-assertion to A2: malicious string in a custom-field value renders as text not HTML (React auto-escape) — was already in risk #6 but the test ownership was implicit; now explicit |

Test count update: ~22 → ~24 cases across 12 → 13 groups (A1 + A1b split).

---

### 15.5 IDOR hardening (v0.2 → v0.3)

Added 2026-05-20 ahead of implementation, applying `.claude/rules/org-scope-user-supplied-ids.md` to this feature's read path.

| Change | Why |
|---|---|
| New test **A12** — cross-org IDOR negative test | The export route receives asset selection via search params (user-supplied IDs). Per the org-scope rule (*"the original bug: edit validated, create did not"*), any user-supplied ID consumed by a query must be proven org-scoped. We already use `getAssetsWhereInput({organizationId, currentSearchParams})` which scopes correctly; A12 makes the guarantee a test, not an implementation memory. CR/Codex security review would flag the absence; front-loading this is exactly what `feedback_pre_pr_self_review` is for |
| New risk register row #7 | Promotes cross-org IDOR to a named ship-blocker rather than implicit in the reuse map |
| Test count: ~24 → ~25 cases / 13 → 14 groups | A12 added |

---

### 15.6 §14 sealed + filename/sig/cap corrections (v0.3.1 → v0.4)

Applied 2026-05-20 from Nikolay's §14 answers + Codex P1 + CR review-pass-2.

| Source | Change |
|---|---|
| **Nikolay §14 Q1** | Columns verbatim — locked |
| **Nikolay §14 Q2** | **Cap removed.** Nikolay pushed back on `MAX_PDF_ROWS`; grep confirmed neither `booking-overview-pdf.tsx` nor `audit-receipt-pdf.tsx` cap row count. Dropped: A8 test, `MAX_PDF_ROWS` constant from §6.0, `asset_pdf_export_truncated` event from §13, `hit_cap` field. Risk #2 reframed: matches existing PDF precedent; rely on browser print + CSV fallback. The cap I proposed was unjustified consistency-breaking work — a real win for "less dumb" |
| **Nikolay §14 Q3** | Landscape — locked |
| **Nikolay §14 Q4** | react-to-print — locked |
| **Codex P1 (line 218)** | `assets.export.$fileName.pdf.tsx` → `assets.export.$fileName[.pdf].tsx` (remix-flat-routes literal-extension bracketing; was inconsistent across the PRD) |
| **CR inline (line 219)** | Same: unify to `[.pdf]` canonical form |
| **CR outside-diff (lines 180-182)** | Loader return type: `Promise<{asset:never}>` → `Promise<Response>` (matches actual HTML-Response contract per A0) |
| Test count: ~25 → ~22 cases / 14 → 13 groups | A8 removed |
| Companion update | Impl PR #2564 stub file gets `MAX_PDF_ROWS` constant + A8 test removed in the same batch — paused-but-aligned |

---

### 15.7 §4.2 adversarial review-pass corrections (v0.4.1 → v0.5)

Self-§4.2 gate run on PR #2564 commit `b40fe9dce` surfaced six findings, four addressed (Option C+ accepted by Nikolay). Process correction added in §4.2 (reviewer ≠ author).

| # | Finding | Resolution |
|---|---|---|
| #1 (🔴) | **A12 was structural-proxy, not behavioral.** Original test asserted only `getAssetsWhereInput` was called with the caller's org id — but the helper was *mocked away*. The security property (foreign-org asset excluded from output) wasn't actually verified | **Fixed.** `db.asset.findMany` mock now returns DIFFERENT rows based on `where.organizationId` (ORG_A_ASSET vs ORG_B_ASSET). A12 asserts: (a) the foreign-org asset id NEVER appears in the response HTML, (b) org-A's own asset DOES appear (proves "filtered correctly" vs "broken empty"), (c) structural backstop kept |
| #2 (🔴) | Multiple tests would fail for the **wrong reason** on `main` (violates §4.2 criterion). A0.b had no workspace-name fixture; A3 used regex-fuzzy accessible name; A5 pinned param names that may not match asset-index conventions; A11 used `process.cwd()` (fragile) | **Fixed.** A0.b: `requirePermission` mock now includes `name: WORKSPACE_NAME` on the organization fixture. A3: §6.0 contract pinned `"Include thumbnails"` as the exact accessible name; tests use it. A5: stopped pinning param names; tests use distinctive *values* that surface regardless of which params the impl picks. A11: switched to `fileURLToPath(import.meta.url)` resolution |
| #4 (🟡) | A9 sanitization was loose — didn't verify the existing `sanitizeFilename` helper was actually invoked. A lazy impl could write a worse custom sanitiser and pass | **Fixed.** `vi.mock("~/utils/sanitize-filename")` + `expect(sanitizeFilenameMock).toHaveBeenCalledWith(workspaceName)`. A9 split into A9.a (basic shape), A9.b (helper enforcement), A9.c (output safety) |
| #6 (🟡) | A4 didn't cover the `includeImages=true, thumbnailUrl=null` edge case — common in real workspaces where many assets lack photos | **Fixed.** New A4.c asserts zero `<img>` when rows have null thumbnail urls even if `includeImages=true` |
| #3 (🟠) | A11 only checks DIRECT imports, not transitive — PRD wording said "transitively" | **Deferred + documented.** A real import-graph walker is its own micro-project. Kept the direct-import check as the v1 protection; PRD wording softened to acknowledge the gap. Re-trigger condition: any new `@react-pdf/renderer`-class dep gets introduced anywhere in the repo |
| #5 (🟢) | A6 date assertion (`textContent.toContain("2026")`) is too loose | **Skipped.** Pure cosmetic nit; revisit if the date rendering ever has a bug |
| (PRD §4.2 process) | **Reviewer == author** (I wrote both PRD §6.1 and the test suite) is a structural conflict the PRD didn't address | **Added.** §4.2 now requires reviewer ≠ author. The author may run an adversarial first pass, but the gate is only "passed" after an independent reviewer signs off |

Test count: ~22 → ~23 cases / 13 → 13 groups (A4.c + A9.b/c added; A12 expanded same group).

The §4.2 gate now passes on the *content* (suite covers what the spec promises behaviorally); the *process* still needs an independent second pass before `/goal` runs.

---

*v0.5 hardens the test suite per the §4.2 adversarial review and the Musk-algorithm step-1 lens applied to high-volume features. The §4.2 gate's content criteria are met; the process criterion (reviewer ≠ author) requires one more independent pass before `/goal` is set. Risk #1 (Safari rendering) remains the one quality-pass gate before general release. PRD is sealed pending that independent pass.*
