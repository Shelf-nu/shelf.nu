# Saved Asset Filter Presets – Backlog & Sprint Plan

## Sprint 1 – Server Foundations
1. **S1-T1:** Draft failing migration tests validating that `AssetFilterPreset` exists with expected columns (id, organizationId, ownerId, name, query, view, timestamps).
2. **S1-T2:** Write failing Vitest specs for `asset-filter-presets/service.server.ts` covering create/list/rename/delete behaviors, duplicate-name handling, and per-user limit enforcement.
3. **S1-T3:** Implement Prisma schema, run migration, and add service code until tests pass.
4. **S1-T4:** Add failing action tests for the advanced asset index route verifying each `intent` (`createPreset`, `renamePreset`, `deletePreset`, `listPresets`).
5. **S1-T5:** Update the Remix action/loader to satisfy intent tests and surface presets in loader data.

## Sprint 2 – Frontend Integration
1. **S2-T1:** Create failing component tests for `AssetFilterPresetsMenu`, `SavePresetDialog`, and rename/delete flows using React Testing Library.
2. **S2-T2:** Implement UI components and provider hooks until the component tests pass.
3. **S2-T3:** Enhance toolbar integration tests to ensure presets appear when the feature flag is on and remain hidden otherwise.
4. **S2-T4:** Wire toast notifications and error handling consistent with existing patterns.

## Sprint 3 – E2E & Launch Prep
1. **S3-T1:** Author failing Playwright spec covering create → apply → rename → delete for a single user.
2. **S3-T2:** Make any remaining polish changes (loading states, accessibility tweaks) until the E2E passes reliably.
3. **S3-T3:** Document rollout steps, update release notes, and prepare customer-facing enablement material.
4. **S3-T4:** Execute manual QA checklist from the UX doc and confirm feature-flag toggling works in staging.

## Cross-Cutting Tasks
- **CC-T1:** Add structured logging for preset creation and deletion once server code lands.
- **CC-T2:** Coordinate feature flag rollout schedule with product and customer success after staging validation.
