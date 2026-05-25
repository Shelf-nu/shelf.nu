# QA Checklist — Preferred Asset Code on List Views

Branch: `feat/preferred-asset-code-on-lists`
Preview: <http://localhost:3040>
Working dir: `shelf-feat-barcode-ids/`

> 📌 **None of this is committed yet.** `git status` shows everything in the working tree. Review at your own pace; commit when you're satisfied.

---

## 1. Smoke (5 min)

- [ ] **App loads cleanly** at http://localhost:3040. Login lands on `/home` without errors.
- [ ] **`pnpm webapp:validate` is clean** (running in the background; check `task #15` status).

---

## 2. Workspace setting (settings → general)

Open `/settings/general` or `/account-details/workspace/<id>/edit`, find the row labeled **"Preferred display code"** (was "QR Code Display").

- [ ] **Addon-OFF workspace** → only `QR Code ID` and `SAM ID` options visible. Subheading explains the upgrade unlocks barcode types.
- [ ] **Addon-ON workspace** → also shows `Code 128`, `Code 39`, `DataMatrix`, `External QR`, `EAN-13`. Subheading confirms add-on is on.
- [ ] Pick `Code 128`, save. Reload — the selector still shows `Code 128` (persisted).
- [ ] Reverting to `QR Code ID` works.

Behind the scenes — every save fires `ORGANIZATION_QR_ID_DISPLAY_PREFERENCE_CHANGED` to the activity event log (verify by `select * from "ActivityEvent" where action='ORGANIZATION_QR_ID_DISPLAY_PREFERENCE_CHANGED' order by "occurredAt" desc limit 5;`).

---

## 3. Per-asset override (asset edit)

Open any asset's edit page (`/assets/:id/edit`). Scroll to the **Barcodes** section.

- [ ] **No barcodes yet** → below the Barcodes input, you see an explanatory message: *"Add a barcode above to make it selectable as the preferred display identifier…"*. List views follow the workspace default.
- [ ] **With one or more barcodes** → a "Preferred display code" section appears with a radio group:
   - `Workspace default` (selected by default)
   - One row per barcode showing its value + type label
- [ ] Selecting a specific barcode and saving → after reload, the radio reflects the saved selection.
- [ ] Reverting to `Workspace default` → after save, the override is cleared.
- [ ] **Addon-OFF** → the Barcodes section is replaced by the existing `UnlockBarcodesBanner`. No override UI appears.

Behind the scenes — every preferred-barcode change fires `ASSET_PREFERRED_BARCODE_CHANGED`.

**Server-side validation** — try forcing a `preferredBarcodeId` to a Barcode belonging to a different asset (via curl or devtools form replay). The action should return a 400 with *"The selected preferred barcode is not linked to this asset."*

---

## 4. List surfaces — the customer payoff

For each surface, **switch the workspace `qrIdDisplayPreference` between QR_ID, SAM_ID, and Code128**, and verify rows reflect the choice. Assets with no Code128 barcode should fall back to QR with the QR icon (silent data-hygiene signal).

### 4.1 Booking overview (Surface 1)

URL: `/bookings/:id/overview`

- [ ] Asset rows show the code as a **subtitle directly below the asset name**, with an icon prefix (QR-style for QR_ID/SAM_ID, barcode-style for barcode types).
- [ ] Kit-grouped rows (assets inside a kit within a booking) also show the badge — they reuse `ListAssetContent`.
- [ ] Workspace preference = Code128, an asset has a Code128 → row shows the Code128 value with barcode icon.
- [ ] Workspace preference = Code128, an asset has no Code128 → row shows QR id with the QR icon, dimmed gray (fallback signal).
- [ ] Per-asset override pointed at a specific barcode → that barcode wins regardless of workspace pref.

### 4.2 Add Assets to Booking modal (Surface 2)

URL: `/bookings/:id/overview/manage-assets`

- [ ] Table now has **`Id` + `Code` columns** side by side (CUID kept for power users per your call).
- [ ] `Code` column shows the resolved value with icon. Christine's original screenshot pain disappears once Code128 is set as preference for that workspace.
- [ ] Searching by a barcode value finds the asset (existing behavior preserved; verify with a known barcode).

### 4.3 `/assets` index — simple mode (Surface 3a)

URL: `/assets`

- [ ] Each row shows the code subtitle below the asset name.
- [ ] Existing column toggles (status / description / etc.) still work.
- [ ] **Advanced mode** (`AssetIndexMode.ADVANCED`) also renders the code chip on the QR ID column, the SAM ID column, and the barcode column — same workspace-preference + per-asset-override behavior as simple mode. Per-column chips use a column-explicit tooltip ("Type: value") rather than the workspace-relative tooltip used on the title-row subtitle.

### 4.4 Kit detail page (Surface 4)

URL: `/kits/:id/assets`

- [ ] Asset rows in the kit's asset list show the badge.
- [ ] Workspace pref switching reflects across rows.

### 4.5 Locations page (Surface 5)

URL: `/locations/:id/assets`

- [ ] Asset rows show the badge below the title.
- [ ] Same fallback behavior as elsewhere.

### 4.6 Audit overview (Surface 6) — strongest case

URL: `/audits/:id/overview`

- [ ] Asset rows in the audit's expected/found/missing tables show the badge prominently. This is *the* surface where Christine's "match physical label to row" job lives.
- [ ] **Search by barcode value** now finds matching audit assets (new in this PR).

---

## 5. Addon-OFF customers (no regressions)

In a workspace where `barcodesEnabled = false`:

- [ ] All list views still render. The badge shows the asset's QR id (always present) with the QR icon. Existing behavior — no surprises.
- [ ] Workspace settings page does **not** show barcode-type options.
- [ ] Asset edit page does **not** show the per-asset override section.
- [ ] No upgrade-nag-spam in lists. Upsell still lives where it always did (the `UnlockBarcodesBanner` on the asset form).

---

## 6. Marina-style migration test (scripted)

The migration script lives at `apps/webapp/scripts/migrate-custom-field-to-barcodes.ts`.

Recommended test sequence in a non-prod workspace:

```bash
cd apps/webapp

# 1. Dry-run first — prints the plan, makes no changes
pnpm tsx scripts/migrate-custom-field-to-barcodes.ts \
  --orgId=<test-org-id> \
  --customFieldName="serial number" \
  --barcodeType=Code128 \
  --dryRun

# 2. Apply (creates Barcode rows, optionally sets as preferred)
pnpm tsx scripts/migrate-custom-field-to-barcodes.ts \
  --orgId=<test-org-id> \
  --customFieldName="serial number" \
  --barcodeType=Code128 \
  --setPreferred
```

- [ ] **Dry-run** prints the plan with counts (will-create / skipped-already-exists / skipped-empty / skipped-non-ASCII). No DB writes.
- [ ] **Apply** creates exactly N barcodes where N matches the dry-run "will create" count.
- [ ] **Re-running the same command** skips already-created barcodes (idempotent). New count is 0.
- [ ] An **audit-log JSON file** is dropped in cwd recording every created barcode.
- [ ] With `--setPreferred`, the affected assets now have `Asset.preferredBarcodeId` pointing at the new Barcode → list views show those values immediately.
- [ ] **Non-ASCII input** (e.g. a serial number with an em dash) is rejected by default; passes with `--allowNonAscii` for non-Code128 types.

---

## 7. Search-by-code (Phase 3)

- [ ] `/assets` and the Add-Assets modal search by **Code128 value + QR id** (existing behavior preserved).
- [ ] **Booking overview asset list** now searches by Code128 value + QR id (new in this PR).
- [ ] **Audit overview asset list** now searches by Code128 value + QR id (new in this PR).
- [ ] Kit detail / Locations list searches: title-only still (deferred — narrow scope makes barcode search less critical).

---

## 8. Schema migration

The migration file is at `packages/database/prisma/migrations/20260522103000_add_preferred_barcode_and_extend_qr_id_display_pref/migration.sql`.

It does **not** auto-apply on dev — the shared dev DB has sibling-branch migrations not in this repo. Two options when you're ready:

1. **Production-style deploy** (one-way, recommended): `pnpm db:deploy-migration` against a fresh DB or the prod-style migration runner.
2. **Manual apply** to the shared dev DB: run the SQL directly via a Postgres client. The 5 `ALTER TYPE ... ADD VALUE` statements + one `ALTER TABLE ... ADD COLUMN` + UNIQUE INDEX + FK + 2 more `ADD VALUE` for ActivityAction.

Until applied, queries that read/write `Asset.preferredBarcodeId` will fail with "column does not exist", and queries that use new enum values will fail. The Prisma client types are correct (already regenerated).

---

## 9. Known v1.1 gaps (deliberately deferred)

- **Audit scan drawer's live expected-assets list** (`expected-assets-list.tsx`) uses a simplified `AuditScannedItem` shape that doesn't carry barcode data. Adding it would require extending the `qr-scanner` atom + drawer rendering. Field workers can still see codes on the audit overview page (Surface 6).
- **Label printing** (`code-preview.tsx`, `bulk-download-qr-dialog.tsx`) gracefully falls back to QR id for any of the new barcode-type enum values — labels won't break, but they also don't yet print the barcode-type's value below the QR image. The asset-code-resolution helper is ready; only the label component needs to consume it.
- **Mobile companion** out of scope by your call — owned by another team.

The rule file at `.claude/rules/code-bearing-entity-list-consistency.md` lists all the asset and kit surfaces so the next contributor handling these gaps has the inventory.

---

## 10. After QA — when you're ready to ship

- [ ] `git status` to review the working tree
- [ ] Apply the schema migration in your preferred way
- [ ] Stage + commit per the 12-commit sequence in the ultraplan (one PR, well-ordered commits)
- [ ] PR description should call out: 8-surface scope (6 done in v1, 2 deferred), label-printing graceful-fallback approach, Marina migration steps, EXPLAIN ANALYZE of `/assets` index loader before/after if you want.
