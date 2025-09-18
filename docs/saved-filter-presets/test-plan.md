# Saved Asset Filter Presets – TDD Test Plan

## Guiding Principles
- Write failing tests before implementing functionality.
- Cover service logic, Remix routes, and UI flows with unit, integration, and E2E tests.
- Reuse existing testing utilities in `test/` and `app/utils/test/`.

## Test Suites

### 1. Service Layer (`app/modules/asset-filter-presets/service.server.test.ts`)
- `createPreset` saves sanitized query and respects per-user limit (happy path & limit exceeded).
- Reject duplicate names within same user/org.
- Require advanced access and organization membership.
- `listPresetsForUser` returns owned + shared presets.
- `updatePreset` allows rename/share toggle for owner/admin; rejects unauthorized users.
- `deletePreset` removes preset and enforces permissions.
- `applyPreset` updates `lastUsedAt` only when delta >5 min and resolves without mutating stored query/view data.

### 2. Remix Routes (`app/routes/api+/asset-filter-presets.test.ts`)
- GET returns grouped presets for owner, shared, admin scenarios.
- POST validates payload (missing name, blank query, duplicate name, over limit).
- PUT handles rename/share toggles with permission checks.
- DELETE removes preset; unauthorized returns 403/404.
- APPLY returns `204` and throttles `lastUsedAt` updates without redirect payload.

### 3. Loader (`app/routes/_layout+/assets._index.test.tsx`)
- When flag enabled, loader includes `savedPresets` array for advanced users.
- Users without advanced access receive empty presets array.
- Feature flag off excludes presets data.

### 4. Component Tests (`app/components/asset-filter-presets/*.test.tsx`)
- `AssetFilterPresetsMenu` renders visibility sections and handles apply button click.
- `SavePresetDialog` shows validation errors from action payload.
- `RenamePresetDialog` submits rename request on confirm.
- Sharing toggle dispatches fetcher call.

### 5. E2E (Playwright) (`test/e2e/saved-filter-presets.spec.ts`)
- Scenario: save preset → apply preset → delete preset (same user).
- Scenario: preset shared by user A visible/applicable to user B.
- Negative: user B cannot rename/delete user A’s shared preset.

## Tooling & Setup
- Seed presets in test database using Prisma factory helpers.
- Use `test/utils/session.server` to mock authenticated sessions.
- Introduce helper `createPresetParams()` to generate sanitized query strings.

## Regression Coverage
- Re-run `npm run test` and `npm run lint` before each commit.
- Add targeted Playwright run for new spec in CI.

## Exit Criteria
- All new tests pass without flake locally.
- Code coverage for service module ≥90% (tracked via Vitest coverage if available).
- QA sign-off on manual checklist from frontend UX doc.
