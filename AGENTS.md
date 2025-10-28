# AGENTS.md

This repository hosts **Shelf.nu**, an asset management platform built with Remix, React, TypeScript, and PostgreSQL. Follow the instructions below when working anywhere in this repository.

## Key Commands

### Development

- `npm run dev` – Start the Remix development server on port 3000.
- `npm run setup` – Generate the Prisma client and apply database migrations before running the app.

### Quality & Testing

- `npm run test` – Execute the Vitest unit test suite.
- `npm run test:cov` – Run tests with coverage reporting.
- `npm run validate` – Run the full validation pipeline (Prisma generation, ESLint, Prettier, TypeScript, unit tests). Run this before committing substantive code changes.
- `npm run lint` / `npm run lint:fix` – Perform ESLint checks or auto-fixes.
- `npm run typecheck` – Run the TypeScript compiler in type-check mode.

### Testing Approach

#### Unit Tests (Vitest)

- Tests co-located with source files
- Happy DOM environment for React component testing
- Run with `npm run test` or `npm run test:cov` for coverage

#### Validation Pipeline

Always run `npm run validate` before committing - this runs:

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

- **Test files**: Co-located with source files (e.g., `app/modules/user/service.server.test.ts`)
- **Shared mocks**: Place in `test/mocks/` directory, organized by domain (remix.tsx, database.ts)
- **Factories**: Place in `test/factories/` directory for generating test data
- **MSW handlers**: Keep in root `mocks/` directory for API mocking

Example directory structure:

```
app/
├── modules/
│   └── user/
│       ├── service.server.ts
│       └── service.server.test.ts  # Co-located test
test/
├── mocks/
│   ├── remix.tsx          # Remix hook mocks
│   └── database.ts        # Database/Prisma mocks
└── factories/
    ├── user.ts            # User factory
    ├── asset.ts           # Asset factory
    └── index.ts           # Export all
mocks/                      # MSW API handlers (kept at root)
├── handlers.ts
└── index.ts
```

#### Path Aliases (Configured)

Path aliases are configured in `vitest.config.ts` for easy imports:

```typescript
import { createUser } from "@factories"; // → test/factories/index.ts
import { createRemixMocks } from "@mocks/remix"; // → test/mocks/remix.tsx
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
6. Follow the testing conventions in “Writing & Organizing Tests” (behavior-first tests, minimal mocking, shared mocks in `test/mocks/`, factories in `test/factories/`).

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
- Include test readability and mock discipline in PR reviews. Overly mocked or verbose tests should be refactored before merge.

## Environment Reminders

- Required environment variables include `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_PUBLIC`, and `SESSION_SECRET`.
- Feature flags such as `ENABLE_PREMIUM_FEATURES`, `DISABLE_SIGNUP`, and `SEND_ONBOARDING_EMAIL` toggle optional functionality.

By following these guidelines, contributions will align with the repository's established workflows and quality standards.
