# Saved Asset Filter Presets – TDD Test Plan

## Guiding Principles
- Write failing tests before implementing functionality at every layer.
- Focus on the private-presets MVP: no sharing, favorites, or analytics writes.
- Reuse existing Remix testing helpers and database factories for consistency.

## Test Suites

### 1. Migration & Schema Tests (`prisma/tests/asset-filter-presets.migration.test.ts`)
- Assert the Prisma client exposes `assetFilterPreset` model with expected columns.
- Verify unique constraint on `(organizationId, ownerId, name)` using migration test harness.

### 2. Service Layer (`app/modules/asset-filter-presets/service.server.test.ts`)
- `createPreset` saves sanitized query/view, enforces 20 preset limit, and rejects duplicates (case-insensitive).
- `listPresetsForUser` returns only the requesting user’s presets and respects organization scoping.
- `renamePreset` updates the name when owned by the user and rejects non-existent or foreign presets with `NotFound` error.
- `deletePreset` removes a preset and ignores ids outside the user/org scope with `NotFound`.
- Validation: blank name, overly long name (>60 chars), or empty query produce specific `ShelfError` codes.

### 3. Remix Action (`app/routes/_layout+/assets._index.action.test.ts`)
- Each `intent` (`createPreset`, `renamePreset`, `deletePreset`, `listPresets`) branches correctly and returns JSON payload.
- Feature flag disabled → each preset intent returns `404`.
- Unauthorized session (no advanced access) receives `403` for create/rename/delete and an empty list for loader requests.
- Successful create/rename/delete responses trigger preset list refresh with updated data.

### 4. Loader (`app/routes/_layout+/assets._index.loader.test.ts`)
- Loader includes `savedPresets` array with the user’s presets when the flag is on.
- Loader returns empty array when user has none or lacks advanced access.
- Flag off removes presets data from the loader output.

### 5. Component Tests (`app/components/asset-filter-presets/*.test.tsx`)
- `AssetFilterPresetsMenu` renders presets alphabetically and fires navigation callback on click.
- `SavePresetDialog` shows inline validation errors returned from action payload.
- Rename flow reuses the dialog and pre-fills the existing name.
- Delete confirmation disables submit while the fetcher is pending and hides the preset afterward.

### 6. E2E (Playwright) (`test/e2e/saved-filter-presets.spec.ts`)
- Scenario: user saves a preset, applies it (URL updates), renames it, then deletes it; final state shows empty list.
- Negative: creating a duplicate name surfaces validation toast without creating an extra preset.
- Feature flag off: presets UI never renders.

## Tooling & Setup
- Seed test database with organizations/users via existing factory helpers.
- Add utility `buildPresetQuery()` that mirrors `cleanParamsForCookie` output for test fixtures.
- Use Remix testing utilities to create authenticated sessions in route tests.

## Regression Coverage
- Run `npm run test`, `npm run lint`, and `npm run typecheck` before merging.
- Include the new Playwright spec in CI’s saved filters feature flag suite.

## Exit Criteria
- All new tests pass consistently (no flakes) locally and in CI.
- Coverage for `service.server.ts` ≥90% lines/branches.
- Manual QA checklist (from UX doc) completed on staging with feature flag enabled and disabled.
