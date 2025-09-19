# Saved Asset Filter Presets – Backlog & Sprint Plan

## Sprint 1 – Foundations
1. **S1-T1:** Create Prisma schema updates & migration tests (write failing migration tests verifying table presence via Prisma client).
2. **S1-T2:** Implement service layer tests per TDD plan (failing tests first).
3. **S1-T3:** Implement service layer functionality to satisfy tests.
4. **S1-T4:** Write Remix API route tests covering CRUD/apply flows (failing first).
5. **S1-T5:** Implement API route handlers and update loader to surface presets.

## Sprint 2 – Frontend Integration
1. **S2-T1:** Draft component tests for dialogs/menu (failing first).
2. **S2-T2:** Build UI components & hooks to satisfy component tests.
3. **S2-T3:** Update advanced asset index toolbar integration tests.
4. **S2-T4:** Implement analytics events & feature flag wiring.

## Sprint 3 – E2E & Polish
1. **S3-T1:** Write Playwright E2E specs for preset lifecycle (failing first).
2. **S3-T2:** Implement backend tweaks needed by E2E (e.g., lastUsedAt throttling) and make tests pass.
3. **S3-T3:** Documentation updates (release notes, admin docs).
4. **S3-T4:** Manual QA & accessibility verification checklist completion.

## Cross-Cutting Tasks
- **CC-T1:** Introduce logging hooks for preset actions.
- **CC-T2:** Update monitoring dashboards with preset metrics (post-launch).
- **CC-T3:** Coordinate feature flag rollout plan with product & CS teams.
