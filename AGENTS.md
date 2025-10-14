# AGENTS.md

This repository hosts **Shelf.nu**, an asset management platform built with Remix, React, TypeScript, and PostgreSQL. Follow the instructions below when working anywhere in this repository.

## Key Commands

### Development

- `npm run dev` – Start the Remix development server on port 3000.
- `npm run setup` – Generate the Prisma client and apply database migrations before running the app.

### Quality & Testing

- `npm run test` – Execute the Vitest unit test suite.
- `npm run test:e2e:dev` – Launch Playwright end-to-end tests with the UI.
- `npm run validate` – Run the full validation pipeline (Prisma generation, ESLint, Prettier, TypeScript, unit tests, and E2E tests). Run this before committing substantive code changes.
- `npm run lint` / `npm run lint:fix` – Perform ESLint checks or auto-fixes.
- `npm run typecheck` – Run the TypeScript compiler in type-check mode.

### Build & Production

- `npm run build` – Build the production bundle.
- `npm run start` – Start the production server.

## Architecture Notes

- Routes live under `app/routes/` (organized with remix-flat-routes; notable groups include `_layout+/`, `_auth+/`, `_welcome+/`, `api+/`, and `qr+/`).
- Business logic resides in `app/modules/` while shared UI lives in `app/components/`.
- Database schema and migrations are in `app/database/` (Prisma-powered, with Supabase RLS and Postgres full-text search).
- Global state uses Jotai atoms in `app/atoms/` and utilities are under `app/utils/`.

## Implementation Guidelines

1. Prefer Remix loaders/actions for server data access and Jotai atoms for complex client state.
2. Keep reusable UI components modular and colocated with domain-specific functionality when appropriate.
3. Follow existing patterns in `app/modules/` for service logic and `app/routes/` for Remix route modules.
4. For database changes, update `app/database/schema.prisma`, create migrations with `npm run db:prepare-migration`, and deploy with the setup command.
5. Maintain documentation and examples in Markdown.

## Bulk Operations & Select All Pattern

When implementing bulk operations that work across multiple pages of filtered data, follow the **ALL_SELECTED_KEY pattern**:

**The Pattern:**

1. **Component Layer** - Pass current search params when "select all" is active
2. **Route/API Layer** - Extract and forward `currentSearchParams`
3. **Service Layer** - Use `getAssetsWhereInput` helper to build where clause from params

**Key Implementation Points:**

- Use `isSelectingAllItems()` from `app/utils/list.ts` to detect select all
- Always pass `currentSearchParams` alongside `assetIds` when ALL_SELECTED_KEY is present
- Use `getAssetsWhereInput({ organizationId, currentSearchParams })` to build Prisma where clause
- Set `takeAll: true` to remove pagination limits

**Working Examples:**

- Export assets: `app/components/assets/assets-index/export-assets-button.tsx`
- Bulk delete: `app/routes/_layout+/assets._index.tsx` (action)
- QR download: `app/routes/api+/assets.get-assets-for-bulk-qr-download.ts`

**📖 Full Documentation:** See [docs/select-all-pattern.md](./docs/select-all-pattern.md) for detailed implementation guide, code examples, and common pitfalls.

## Documentation & Research

- Before starting significant feature work or architectural changes, review the guides in the `docs/` directory. They contain
  up-to-date development practices, architecture deep-dives, and onboarding materials that must be followed when extending
  Shelf.nu.
- Cross-reference any relevant doc-specific checklists or conventions and incorporate them into your implementation plan and
  PR notes.

## Git Practices

- Commit after completing a coherent task using descriptive messages.
- Always use Conventional Commits spec when making commits and opening PRs: https://www.conventionalcommits.org/en/v1.0.0/
- Do **not** add "🤖 Generated with Claude Code" or similar co-authored trailers to commits.
- Ensure the working tree is clean and applicable checks (including `npm run validate` for code changes) pass before requesting review.

## Environment Reminders

- Required environment variables include `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_PUBLIC`, and `SESSION_SECRET`.
- Feature flags such as `ENABLE_PREMIUM_FEATURES`, `DISABLE_SIGNUP`, and `SEND_ONBOARDING_EMAIL` toggle optional functionality.

By following these guidelines, contributions will align with the repository's established workflows and quality standards.
