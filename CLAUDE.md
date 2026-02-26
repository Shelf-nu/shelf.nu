# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

This is a **pnpm + Turborepo monorepo**. Use `pnpm` instead of `npm`.

Root-level convenience scripts follow the `<app>:<task>` pattern (e.g., `webapp:dev`, `docs:build`). When adding new apps that require dev servers or build steps, add matching `<app>:<task>` shortcuts to the root `package.json`.

### Webapp

- `pnpm webapp:dev` - Start webapp dev server on port 3000
- `pnpm webapp:build` - Build webapp for production
- `pnpm webapp:test -- --run` - Run Vitest unit tests (always use `--run` flag)
- `pnpm webapp:validate` - Run all tests, linting, and typecheck (use before commits)
- `pnpm webapp:start` - Start webapp production server locally (loads `.env` from monorepo root)

**IMPORTANT:** When running tests manually, ALWAYS use the `--run` flag to run tests once and exit. Without `--run`, Vitest runs in watch mode which consumes excessive memory. Never run multiple test processes in parallel as this can freeze the system.

### Docs

- `pnpm docs:dev` - Start docs dev server on port 5173
- `pnpm docs:build` - Build docs for production
- `pnpm docs:preview` - Preview docs production build on port 5174

### Code Quality

- `pnpm turbo lint` - ESLint checking (all packages)
- `pnpm --filter @shelf/webapp lint:fix` - Fix ESLint issues automatically
- `pnpm turbo typecheck` - TypeScript type checking (all packages)
- `pnpm run format` - Prettier code formatting (root-level)
- `pnpm --filter @shelf/webapp precommit` - Complete pre-commit validation

### Database

All database commands run via the `@shelf/database` package (`packages/database/`). This package owns the Prisma schema, migrations, and client generation. The webapp does **not** manage database concerns directly — it consumes `@shelf/database` as a workspace dependency.

- `pnpm db:generate` - Generate Prisma client after schema changes
- `pnpm db:prepare-migration` - Create new database migration
- `pnpm db:deploy-migration` - Apply migrations and regenerate client
- `pnpm db:reset` - Reset database (destructive!)
- `pnpm webapp:setup` - Generate Prisma client + deploy migrations (for initial setup/onboarding)

### Build & Production

- `pnpm turbo build` - Build all packages and apps for **production**
- `pnpm webapp:start` - Start production server locally (loads `.env` from monorepo root)
- `pnpm run start` (inside `apps/webapp/`) - Used by Docker/Fly (env vars from platform)

## Monorepo Structure

This is a **pnpm workspaces + Turborepo** monorepo. All packages are defined in `pnpm-workspace.yaml` and orchestrated by `turbo.json`.

### Apps

| Package         | Path           | Description                                                                                                           |
| --------------- | -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `@shelf/webapp` | `apps/webapp/` | Remix web application — the main product. Contains routes, components, modules (business logic), and integrations.    |
| `@shelf/docs`   | `apps/docs/`   | Developer documentation site (VitePress). Contains guides on local development, database triggers, architecture, etc. |

### Packages

| Package           | Path                 | Description                                                                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@shelf/database` | `packages/database/` | **Owns all database concerns**: Prisma schema (`prisma/schema.prisma`), migrations (`prisma/migrations/`), and the `createDatabaseClient()` factory (`src/client.ts`). All `db:*` root scripts delegate to this package. The webapp imports from this package — it does **not** run Prisma commands directly in production. |

### Tooling

| Package                    | Path                  | Description                                                           |
| -------------------------- | --------------------- | --------------------------------------------------------------------- |
| `@shelf/typescript-config` | `tooling/typescript/` | Shared `tsconfig` base configurations extended by all other packages. |

### How packages connect

- **Webapp → Database**: The webapp depends on `@shelf/database` (workspace dependency). Its `app/database/db.server.ts` is a thin wrapper that calls `createDatabaseClient()` from `@shelf/database`. All 135+ `~/database/db.server` imports in the webapp work unchanged.
- **Webapp → Prisma types**: The webapp's `build`, `typecheck`, and `precommit` scripts run `prisma generate` to ensure types are available. In CI, this is done via `pnpm --filter @shelf/database run db:generate`.
- **Vite config**: The webapp's `vite.config.ts` includes `ssr.noExternal: ["@shelf/database"]` so Vite bundles it correctly, and aliases `.prisma/client/index-browser` for browser builds.

## Architecture Overview

**Shelf.nu** is an asset management platform built with Remix, React, TypeScript, and PostgreSQL.

### Core Technologies

- **Remix** - Full-stack React framework with file-based routing
- **Prisma** - Database ORM with PostgreSQL
- **Supabase** - Authentication, storage, and database hosting
- **Tailwind CSS + Radix UI** - Styling and UI components
- **Jotai** - Atomic state management

### Key Directory Structure

```
shelf/
├── turbo.json                       # Turborepo pipeline config
├── pnpm-workspace.yaml              # Workspace package definitions
├── packages/
│   └── database/                    # @shelf/database — Prisma client + types
│       ├── prisma/schema.prisma
│       ├── prisma/migrations/
│       └── src/client.ts            # createDatabaseClient() factory
├── apps/
│   └── webapp/                      # @shelf/webapp — Remix app
│       ├── app/
│       │   ├── routes/              # File-based routes (remix-flat-routes)
│       │   ├── modules/             # Business logic services
│       │   ├── components/          # Reusable React components
│       │   ├── database/db.server.ts # Thin re-export from @shelf/database
│       │   ├── atoms/               # Jotai state atoms
│       │   ├── utils/               # Utility functions
│       │   └── integrations/        # Third-party service integrations
│       └── server/                  # Hono server entry + middleware
└── tooling/
    └── typescript/                  # Shared tsconfig bases
```

### Route Organization

- `_layout+/` - Main authenticated application routes
- `_auth+/` - Authentication and login routes
- `_welcome+/` - User onboarding flow
- `api+/` - API endpoints
- `qr+/` - QR code handling for assets

## Development Patterns

### State Management

- **Server State**: Remix loaders/actions for data fetching and mutations
- **Client State**: Jotai atoms for complex UI state
- **URL State**: Search params for filters, pagination, and bookmarks

### Data Layer

- **Prisma Schema**: Located in `packages/database/prisma/schema.prisma` (owned by `@shelf/database`)
- **Client Generation**: Always run via `@shelf/database` (`pnpm db:generate`), never from the webapp directly
- **DB Client**: `@shelf/database` exports `createDatabaseClient()` factory; the webapp's `app/database/db.server.ts` is a thin wrapper
- **Row Level Security (RLS)**: Implemented via Supabase policies
- **Full-text Search**: PostgreSQL search across assets and bookings

### Component Architecture

- **Modular Services**: Business logic separated into `apps/webapp/app/modules/`
- **Reusable Components**: Organized by feature/domain in `apps/webapp/app/components/`
- **Form Handling**: Remix Form with client-side validation
- **UI Primitives**: Radix UI components with Tailwind styling
- **Date Display**: Always use the `DateS` component (`apps/webapp/app/components/shared/date.tsx`) for displaying dates in the UI. Do not use raw `toLocaleDateString()` or other custom date formatting.

### Email Templates

All HTML emails must follow the design established in
`app/emails/stripe/audit-trial-welcome.tsx`:

- **React Email components**: `Html`, `Head`, `Container`, `Text`, `Button`, `Link`
- **LogoForEmail** at the top of every email
- **Shared styles** from `app/emails/styles.ts` (`styles.p`, `styles.h2`, `styles.button`, `styles.li`)
- **Personalized greeting** with user's first name: `Hey {firstName},`
- **CTA buttons** using `styles.button` (not bare links)
- **Info/warning boxes**: yellow background `#FFF8E1` + border `#FFE082` for important notices
- **Both HTML and plain text exports**: HTML via `render()`, plain text as template literal
- **Send wrapper function** with `try/catch` + `Logger.error` + `ShelfError`
- **Closing**: `The Shelf Team`

### Disabled State for Form Submissions

Always use the `useDisabled` hook from `~/hooks/use-disabled` to disable buttons during form submission. Do **not** use `useNavigation` directly to check `navigation.state`.

```typescript
import { useDisabled } from "~/hooks/use-disabled";

// Inside component:
const disabled = useDisabled();
// For fetcher forms, pass the fetcher:
const disabled = useDisabled(fetcher);

<Button type="submit" disabled={disabled}>
  {disabled ? "Saving..." : "Save"}
</Button>
```

### Deprecated Components

- **DropdownMenu** (`apps/webapp/app/components/shared/dropdown.tsx`): Do not use for new features. Instead, use `Popover` from `@radix-ui/react-popover` with custom select behavior. See `apps/webapp/app/components/assets/assets-index/advanced-filters/field-selector.tsx` for a good example implementation.

### Form Validation Pattern (Required)

**IMPORTANT:** All forms MUST display server-side validation errors as a fallback. Client-side validation can fail or be bypassed, so server-side errors must always be shown to users.

**Why This Matters:**

- Client-side validation can be bypassed (disabled JS, modified requests)
- Zod schemas may behave differently on client vs server (e.g., date comparisons)
- Users must always see meaningful error messages, never generic "Something went wrong"

**Implementation Steps:**

1. **Import required utilities:**

```typescript
import { useActionData } from "react-router";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
```

2. **Get validation errors from action data:**

```typescript
// Inside your component
const actionData = useActionData<DataOrErrorResponse>();

/** This handles server side errors in case client side validation fails */
const validationErrors = getValidationErrors<typeof yourZodSchema>(
  actionData?.error
);
```

3. **Display server errors as fallback in each input:**

```typescript
<Input
  name={zo.fields.fieldName()}
  error={
    validationErrors?.fieldName?.message || zo.errors.fieldName()?.message
  }
  // ... other props
/>
```

**Complete Example:**

```typescript
// Schema definition
export const myFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  date: z.coerce.date().min(new Date(), "Date must be in the future"),
});

// Component
export default function MyForm() {
  const zo = useZorm("MyForm", myFormSchema);

  const actionData = useActionData<DataOrErrorResponse>();
  const validationErrors = getValidationErrors<typeof myFormSchema>(
    actionData?.error
  );

  return (
    <Form method="POST">
      <Input
        name={zo.fields.name()}
        error={validationErrors?.name?.message || zo.errors.name()?.message}
        label="Name"
      />
      <Input
        name={zo.fields.email()}
        error={validationErrors?.email?.message || zo.errors.email()?.message}
        label="Email"
      />
      <Input
        type="datetime-local"
        name={zo.fields.date()}
        error={validationErrors?.date?.message || zo.errors.date()?.message}
        label="Date"
      />
      <Button type="submit">Submit</Button>
    </Form>
  );
}
```

**Working Examples:**

- Reminder dialog: `apps/webapp/app/components/asset-reminder/set-or-edit-reminder-dialog.tsx`
- Booking form: `apps/webapp/app/components/booking/forms/edit-booking-form.tsx`

### Accessibility

All UI implementations must meet **WCAG 2.1 AA** as a minimum. This includes:

- Sufficient color contrast ratios (4.5:1 for normal text, 3:1 for large text)
- All interactive elements must be keyboard accessible
- Form inputs must have associated labels
- Use `aria-describedby` to link inputs to helper/error text
- Meaningful alt text for images and icons
- Focus indicators must be visible

### Code Abstraction

- When you notice duplicated code patterns across multiple files or functions,
  abstract them into reusable helper functions
- Before implementing new functionality, check if similar logic already exists
  that can be extracted and reused
- Keep helper functions focused on a single responsibility
- Place shared helpers near the code that uses them, or in a shared utils file
  if used across multiple modules

### Key Business Features

- **Asset Management**: CRUD operations, QR code generation, image processing
- **Booking System**: Calendar integration, conflict detection, PDF generation
- **Multi-tenancy**: Organization-based data isolation
- **Authentication**: Supabase Auth with SSO support

### Bulk Operations & Select All Pattern

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

**📖 Full Documentation:** See [docs/select-all-pattern.md](./apps/docs/select-all-pattern.md) for detailed implementation guide, code examples, and common pitfalls.

## Testing Approach

### Unit Tests (Vitest)

- Tests co-located with source files
- Happy DOM environment for React component testing
- Run with `pnpm webapp:test -- --run` or `pnpm --filter @shelf/webapp test:cov` for coverage

### Validation Pipeline

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

## Environment Configuration

The `.env` file lives at the **monorepo root** (not inside `apps/webapp/`). Copy `.env.example` to `.env` and fill in your values. Vite, Prisma, and all `db:*` commands load from this single root file.

### Required Environment Variables

- `DATABASE_URL` and `DIRECT_URL` - PostgreSQL connections
- `SUPABASE_URL` and `SUPABASE_ANON_PUBLIC` - Supabase configuration
- `SESSION_SECRET` - Session encryption key

### Feature Flags

- `ENABLE_PREMIUM_FEATURES` - Toggle subscription requirements
- `DISABLE_SIGNUP` - Control user registration
- `SEND_ONBOARDING_EMAIL` - Control onboarding emails

## Important Files to Understand

1. **`packages/database/prisma/schema.prisma`** - Complete database schema and relationships
2. **`apps/webapp/app/config/shelf.config.ts`** - Application configuration and constants
3. **`apps/webapp/app/modules/`** - Core business logic services (asset, booking, user, etc.)
4. **`apps/webapp/app/routes/_layout+/`** - Main authenticated application routes
5. **`apps/webapp/vite.config.ts`** - Build configuration with Remix and development settings
6. **`packages/database/src/client.ts`** - Database client factory (shared across apps)

## Development Workflow

1. **Database Changes**: Modify `packages/database/prisma/schema.prisma` → `pnpm db:prepare-migration` → `pnpm db:deploy-migration` (runs via `@shelf/database`)
2. **New Features**: Create in `apps/webapp/app/modules/` for business logic, `apps/webapp/app/routes/` for pages
3. **Component Updates**: Follow existing patterns in `apps/webapp/app/components/`
4. **Testing**: Write unit tests for utilities  
   Follow the testing conventions outlined in the Writing & Organizing Tests section to ensure consistent, behavior-driven testing and minimal mocking.
5. **Pre-commit**: Always run `pnpm webapp:validate` to ensure code quality

## Git and Version control

- **NEVER stage (`git add`) or commit files automatically.** Only stage or commit when the user explicitly asks you to do so.
- Always use Conventional Commits spec when making commits and opening PRs: https://www.conventionalcommits.org/en/v1.0.0/
- use descriptive commit messages that capture the full scope of the changes
- **IMPORTANT: Each line in the commit message body must be ≤ 100 characters**
  - Wrap long lines to stay within the limit
  - This is enforced by commitlint pre-commit hook
  - Subject line can be longer, only body lines are restricted
- dont add 🤖 Generated with [Claude Code](https://claude.ai code) & Co-Authored-By: Claude <noreply@anthropic.com>" because it clutters the commits
- Include test readability and mock discipline in PR reviews. Overly mocked or verbose tests should be refactored before merge.

## Rule Improvement Triggers

- New code patterns not covered by existing rules
- Repeated similar implementations across files
- Common error patterns that could be prevented
- New libraries or tools being used consistently
- Emerging best practices in the codebase

# Analysis Process:

- Compare new code with existing rules
- Identify patterns that should be standardized
- Look for references to external documentation
- Check for consistent error handling patterns
- Monitor test patterns and coverage

# Rule Updates:

- **Add New Rules When:**

  - A new technology/pattern is used in 3+ files
  - Common bugs could be prevented by a rule
  - Code reviews repeatedly mention the same feedback
  - New security or performance patterns emerge

- **Modify Existing Rules When:**

  - Better examples exist in the codebase
  - Additional edge cases are discovered
  - Related rules have been updated
  - Implementation details have changed

- **Example Pattern Recognition:**

  ```typescript
  // If you see repeated patterns like:
  const data = await prisma.user.findMany({
    select: { id: true, email: true },
    where: { status: "ACTIVE" },
  });

  // Consider adding to the files
  // - Standard select fields
  // - Common where conditions
  // - Performance optimization patterns
  ```

- **Rule Quality Checks:**
- Rules should be actionable and specific
- Examples should come from actual code
- References should be up to date
- Patterns should be consistently enforced

## Continuous Improvement:

- Monitor code review comments
- Track common development questions
- Update rules after major refactors
- Add links to relevant documentation
- Cross-reference related rules

## Rule Deprecation

- Mark outdated patterns as deprecated
- Remove rules that no longer apply
- Update references to deprecated rules
- Document migration paths for old patterns

## Documentation Updates:

- Keep examples synchronized with code
- Update references to external docs
- Maintain links between related rules
- Document breaking changes

- When you write any knowledgebase articles or documentation always provide the content in markdown
