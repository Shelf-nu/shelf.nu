# AGENTS.md

This repository hosts **Shelf.nu**, an asset management platform built with Remix, React, TypeScript, and PostgreSQL. This is a **pnpm + Turborepo monorepo**. Use `pnpm` instead of `npm`. Follow the instructions below when working anywhere in this repository.

## Monorepo Structure

- `apps/webapp/` — `@shelf/webapp` — Remix web application
- `packages/database/` — `@shelf/database` — Prisma schema, migrations, and client factory
- `tooling/typescript/` — `@shelf/typescript-config` — Shared tsconfig bases

All database concerns (schema, migrations, Prisma client generation) are owned by `@shelf/database`. The webapp consumes it as a workspace dependency via `apps/webapp/app/database/db.server.ts`.

## Key Commands

### Development

- `pnpm webapp:dev` – Start the Remix development server on port 3000.
- `pnpm webapp:setup` – Generate the Prisma client and apply database migrations (for initial setup/onboarding).

### Database

All database commands run via the `@shelf/database` package:

- `pnpm db:generate` – Generate the Prisma client after schema changes.
- `pnpm db:prepare-migration` – Create a new database migration.
- `pnpm db:deploy-migration` – Apply migrations and regenerate client.
- `pnpm db:reset` – Reset the database (destructive!).

### Quality & Testing

- `pnpm webapp:test -- --run` – Execute the Vitest unit test suite (always use `--run` to avoid watch mode).
- `pnpm webapp:validate` – Run the full validation pipeline (Prisma generation, ESLint, Prettier, TypeScript, unit tests). Run this before committing substantive code changes.
- `pnpm turbo lint` – ESLint checking (all packages).
- `pnpm --filter @shelf/webapp lint:fix` – Fix ESLint issues automatically.
- `pnpm turbo typecheck` – TypeScript type checking (all packages).

### Testing Approach

#### Unit Tests (Vitest)

- Tests co-located with source files
- Happy DOM environment for React component testing
- Run with `pnpm webapp:test -- --run` for a single run
- **IMPORTANT:** Always use `--run` flag. Without it, Vitest runs in watch mode which consumes excessive memory.

#### Validation Pipeline

Always run `pnpm webapp:validate` before committing - this runs:

1. Prisma type generation
2. ESLint with auto-fix
3. Prettier formatting
4. TypeScript checking
5. Unit tests

### Writing & Organizing Tests

#### Test Philosophy

- Write behavior-driven tests focusing on observable outcomes rather than implementation details.
- Tests should describe what the system does, not how it does it.
- Avoid testing internal private methods or state; instead, test public interfaces and user-visible effects.

#### When to Mock

- Mock only external network calls, time-based functions, feature flags, or heavy dependencies that are impractical or slow to run in tests.
- Avoid mocking internal business logic or utility functions to keep tests realistic and maintainable.
- Prefer using real implementations where possible to catch integration issues early.

#### Mock Justification Rule

- Every mock must be accompanied by a `// why:` comment explaining the reason for mocking.
- This encourages thoughtful use of mocks and helps reviewers understand test design choices.

#### Organizing Mocks and Factories

- **Test files**: Co-located with source files (e.g., `apps/webapp/app/modules/user/service.server.test.ts`)
- **Shared mocks**: Place in `apps/webapp/test/mocks/` directory, organized by domain (remix.tsx, database.ts)
- **Factories**: Place in `apps/webapp/test/factories/` directory for generating test data
- **MSW handlers**: Keep in `apps/webapp/mocks/` directory for API mocking

Example directory structure:

```
apps/webapp/
├── app/
│   ├── modules/
│   │   └── user/
│   │       ├── service.server.ts
│   │       └── service.server.test.ts  # Co-located test
├── test/
│   ├── mocks/
│   │   ├── remix.tsx          # Remix hook mocks
│   │   └── database.ts        # Database/Prisma mocks
│   └── factories/
│       ├── user.ts            # User factory
│       ├── asset.ts           # Asset factory
│       └── index.ts           # Export all
└── mocks/                      # MSW API handlers
    ├── handlers.ts
    └── index.ts
```

#### Path Aliases (Configured)

Path aliases are configured in `vitest.config.ts` for easy imports:

```typescript
import { createUser } from "@factories"; // → apps/webapp/test/factories/index.ts
import { createRemixMocks } from "@mocks/remix"; // → apps/webapp/test/mocks/remix.tsx
```

#### Factories & Test Data

- Use factories to generate consistent and realistic test data.
- Factories should allow overrides for specific fields to tailor data for each test case.
- Avoid hardcoding data within tests; use factories to keep tests clean and maintainable.

Example factory usage:

```typescript
import { userFactory } from "@factories/userFactory";

const testUser = userFactory.build({ role: "admin" });
```

#### Pre-Commit Checklist

Before committing tests:

- Ensure tests are behavior-driven and do not rely heavily on implementation details.
- Confirm mocks have `// why:` comments explaining their necessity.
- Verify tests run quickly and reliably without flaky behavior.
- Check that test data is generated via factories or well-structured mocks.
- Review test readability and maintainability.

### Build & Production

- `pnpm turbo build` – Build all packages and apps for production.
- `pnpm webapp:start` – Start the production server.

## Architecture Notes

- Routes live under `apps/webapp/app/routes/` (organized with remix-flat-routes; notable groups include `_layout+/`, `_auth+/`, `_welcome+/`, `api+/`, and `qr+/`).
- Business logic resides in `apps/webapp/app/modules/` while shared UI lives in `apps/webapp/app/components/`.
- Database schema and migrations are in `packages/database/prisma/` (Prisma-powered, with Supabase RLS and Postgres full-text search).
- The webapp's `apps/webapp/app/database/db.server.ts` is a thin wrapper around `@shelf/database`'s `createDatabaseClient()` factory.
- Global state uses Jotai atoms in `apps/webapp/app/atoms/` and utilities are under `apps/webapp/app/utils/`.

## Implementation Guidelines

1. Prefer Remix loaders/actions for server data access and Jotai atoms for complex client state.
2. Keep reusable UI components modular and colocated with domain-specific functionality when appropriate.
3. Follow existing patterns in `apps/webapp/app/modules/` for service logic and `apps/webapp/app/routes/` for Remix route modules.
4. For database changes, update `packages/database/prisma/schema.prisma`, create migrations with `pnpm db:prepare-migration`, and deploy with `pnpm db:deploy-migration`.
5. Maintain documentation and examples in Markdown.
6. Follow the testing conventions in "Writing & Organizing Tests" (behavior-first tests, minimal mocking, shared mocks in `apps/webapp/test/mocks/`, factories in `apps/webapp/test/factories/`).

## Bulk Operations & Select All Pattern

When implementing bulk operations that work across multiple pages of filtered data, follow the **ALL_SELECTED_KEY pattern**:

**The Pattern:**

1. **Component Layer** - Pass current search params when "select all" is active
2. **Route/API Layer** - Extract and forward `currentSearchParams`
3. **Service Layer** - Use `getAssetsWhereInput` helper to build where clause from params

**Key Implementation Points:**

- Use `isSelectingAllItems()` from `apps/webapp/app/utils/list.ts` to detect select all
- Always pass `currentSearchParams` alongside `assetIds` when ALL_SELECTED_KEY is present
- Use `getAssetsWhereInput({ organizationId, currentSearchParams })` to build Prisma where clause
- Set `takeAll: true` to remove pagination limits

**Working Examples:**

- Export assets: `apps/webapp/app/components/assets/assets-index/export-assets-button.tsx`
- Bulk delete: `apps/webapp/app/routes/_layout+/assets._index.tsx` (action)
- QR download: `apps/webapp/app/routes/api+/assets.get-assets-for-bulk-qr-download.ts`

**Full Documentation:** See [docs/select-all-pattern.md](./apps/docs/select-all-pattern.md) for detailed implementation guide, code examples, and common pitfalls.

## Documentation & Research

- Before starting significant feature work or architectural changes, review the guides in the `apps/docs/` directory. They contain
  up-to-date development practices, architecture deep-dives, and onboarding materials that must be followed when extending
  Shelf.nu.
- Cross-reference any relevant doc-specific checklists or conventions and incorporate them into your implementation plan and
  PR notes.

## Git Practices

- Commit after completing a coherent task using descriptive messages.
- **CRITICAL: NEVER commit changes without explicit user instruction.** Always wait for the user to review staged changes and explicitly ask you to commit before running `git commit`. Stage changes with `git add` and inform the user they are ready for review, but DO NOT commit.
- Always use Conventional Commits spec when making commits and opening PRs: https://www.conventionalcommits.org/en/v1.0.0/
- Do **not** add "Generated with Claude Code" or similar co-authored trailers to commits.
- Ensure the working tree is clean and applicable checks (including `pnpm webapp:validate` for code changes) pass before requesting review.
- Include test readability and mock discipline in PR reviews. Overly mocked or verbose tests should be refactored before merge.

## Environment Reminders

- The `.env` file lives at the **monorepo root** (not inside `apps/webapp/`). Copy `.env.example` to `.env` and fill in your values.
- Required environment variables include `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_PUBLIC`, and `SESSION_SECRET`.
- Feature flags such as `ENABLE_PREMIUM_FEATURES`, `DISABLE_SIGNUP`, and `SEND_ONBOARDING_EMAIL` toggle optional functionality.

By following these guidelines, contributions will align with the repository's established workflows and quality standards.
