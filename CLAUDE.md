# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Essential Commands

### Development

- `npm run dev` - Start development server on port 3000
- `npm run test` - Run Vitest unit tests
- `npm run test:e2e:dev` - Run Playwright E2E tests with UI
- `npm run validate` - Run all tests, linting, and typecheck (use before commits)

### Code Quality

- `npm run lint` - ESLint checking
- `npm run lint:fix` - Fix ESLint issues automatically
- `npm run typecheck` - TypeScript type checking
- `npm run format` - Prettier code formatting
- `npm run precommit` - Complete pre-commit validation

### Database

- `npm run setup` - Generate Prisma client and deploy migrations
- `npm run db:generate-type` - Generate Prisma client after schema changes
- `npm run db:prepare-migration` - Create new database migration

### Build & Production

- `npm run build` - Build for **production**
- `npm run start` - Start production server

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
app/
├── routes/          # Remix file-based routes (using remix-flat-routes)
├── modules/         # Business logic services
├── components/      # Reusable React components
├── database/        # Prisma schema and migrations
├── atoms/           # Jotai state atoms
├── utils/           # Utility functions
└── integrations/    # Third-party service integrations
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

- **Prisma Schema**: Located in `app/database/schema.prisma`
- **Row Level Security (RLS)**: Implemented via Supabase policies
- **Full-text Search**: PostgreSQL search across assets and bookings

### Component Architecture

- **Modular Services**: Business logic separated into `app/modules/`
- **Reusable Components**: Organized by feature/domain in `app/components/`
- **Form Handling**: Remix Form with client-side validation
- **UI Primitives**: Radix UI components with Tailwind styling

### Key Business Features

- **Asset Management**: CRUD operations, QR code generation, image processing
- **Booking System**: Calendar integration, conflict detection, PDF generation
- **Multi-tenancy**: Organization-based data isolation
- **Authentication**: Supabase Auth with SSO support

## Testing Approach

### Unit Tests (Vitest)

- Tests co-located with source files
- Happy DOM environment for React component testing
- Run with `npm run test` or `npm run test:cov` for coverage

### E2E Tests (Playwright)

- Located in `/test/e2e/`
- Chromium browser testing
- Run with `npm run test:e2e:dev` (with UI) or `npm run test:e2e:run`

### Validation Pipeline

Always run `npm run validate` before committing - this runs:

1. Prisma type generation
2. ESLint with auto-fix
3. Prettier formatting
4. TypeScript checking
5. Unit tests
6. E2E tests

## Environment Configuration

### Required Environment Variables

- `DATABASE_URL` and `DIRECT_URL` - PostgreSQL connections
- `SUPABASE_URL` and `SUPABASE_ANON_PUBLIC` - Supabase configuration
- `SESSION_SECRET` - Session encryption key

### Feature Flags

- `ENABLE_PREMIUM_FEATURES` - Toggle subscription requirements
- `DISABLE_SIGNUP` - Control user registration
- `SEND_ONBOARDING_EMAIL` - Control onboarding emails

## Important Files to Understand

1. **`app/database/schema.prisma`** - Complete database schema and relationships
2. **`app/config/shelf.config.ts`** - Application configuration and constants
3. **`app/modules/`** - Core business logic services (asset, booking, user, etc.)
4. **`app/routes/_layout+/`** - Main authenticated application routes
5. **`vite.config.ts`** - Build configuration with Remix and development settings

## Development Workflow

1. **Database Changes**: Modify `schema.prisma` → `npm run db:prepare-migration` → `npm run db:deploy`
2. **New Features**: Create in `app/modules/` for business logic, `app/routes/` for pages
3. **Component Updates**: Follow existing patterns in `app/components/`
4. **Testing**: Write unit tests for utilities, E2E tests for user flows
5. **Pre-commit**: Always run `npm run validate` to ensure code quality

## Git and Version control

- add and commit automatically whenever a task is finished\
- use descriptive commit messages that capture the full scope of the changes
- dont add 🤖 Generated with [Claude Code](https://claude.ai code) & Co-Authored-By: Claude <noreply@anthropic.com>" because it clutters the commits

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