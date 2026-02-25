# GitHub Copilot Instructions for Shelf.nu

**ALWAYS follow these instructions first. Only fallback to additional search and context gathering if the information here is incomplete or found to be in error.**

## Repository Overview

Shelf.nu is an open-source asset management platform built with Remix, React, TypeScript, and PostgreSQL. It provides QR code generation, asset tracking, booking management, and team collaboration features.

This is a **pnpm + Turborepo monorepo** with the following structure:

- `apps/webapp/` — `@shelf/webapp` — Remix web application
- `packages/database/` — `@shelf/database` — Prisma schema, migrations, and client factory
- `tooling/typescript/` — `@shelf/typescript-config` — Shared tsconfig bases

All database concerns (schema, migrations, Prisma client generation) are owned by `@shelf/database`. The webapp consumes it as a workspace dependency.

## Working Effectively

### Prerequisites

- **Node.js** v22+ (officially required)
- **pnpm** package manager (version specified in root `package.json` `packageManager` field)
- **Git** version control
- **Supabase account** for database and authentication
- **Network access** for dependency downloads and Prisma setup

### Bootstrap and Setup Commands

Run these commands in order. **NEVER CANCEL** any build or setup commands - they may take significant time:

```bash
# 1. Install dependencies (60+ seconds, NEVER CANCEL)
pnpm install
# Timeout: Set 10+ minutes.

# 2. Copy environment template
cp .env.example .env
# CRITICAL: You must configure .env with actual Supabase credentials before proceeding.
# The .env file lives at the monorepo root (not inside apps/webapp/).

# 3. Generate Prisma types (requires network access)
pnpm db:generate
# Timeout: Set 5+ minutes. NEVER CANCEL. Will fail without network access.

# 4. Setup database (requires valid DATABASE_URL in .env)
pnpm webapp:setup
# Timeout: Set 10+ minutes. NEVER CANCEL. Generates Prisma client + deploys migrations.
```

### Build Commands

**CRITICAL TIMING**: Build commands take significant time. **NEVER CANCEL**:

```bash
# Production build (30+ seconds, NEVER CANCEL)
pnpm turbo build
# Timeout: Set 60+ minutes. May show chunk size warnings - this is normal.

# Development server (requires database connection)
pnpm webapp:dev
# Timeout: Set 10+ minutes for startup. Server runs on https://localhost:3000
```

### Testing Commands

**NEVER CANCEL** test commands. Set appropriate timeouts:

```bash
# Unit tests (10+ seconds, NEVER CANCEL)
pnpm webapp:test -- --run
# Timeout: Set 30+ minutes. Many tests fail without Prisma types generated.
# IMPORTANT: Always use --run to avoid watch mode.

# Install E2E test browsers (requires network access, NEVER CANCEL)
pnpm --filter @shelf/webapp test:e2e:install
# Timeout: Set 60+ minutes. Downloads large browser binaries.

# E2E tests with UI (requires running app, NEVER CANCEL)
pnpm --filter @shelf/webapp test:e2e:dev
# Timeout: Set 60+ minutes. Requires app running on localhost:3000.

# E2E tests headless (requires running app, NEVER CANCEL)
pnpm --filter @shelf/webapp test:e2e:run
# Timeout: Set 60+ minutes. Includes pre-build step.
```

### Code Quality Commands

Always run before committing:

```bash
# ESLint checking (5+ seconds)
pnpm turbo lint
# Timeout: Set 10+ minutes. May show many existing errors.

# Fix ESLint issues automatically
pnpm --filter @shelf/webapp lint:fix
# Timeout: Set 10+ minutes.

# TypeScript checking (fails without Prisma types)
pnpm turbo typecheck
# Timeout: Set 10+ minutes. Requires pnpm db:generate first.

# Format code with Prettier (10+ seconds)
pnpm run format
# Timeout: Set 5+ minutes.

# Complete validation pipeline (NEVER CANCEL)
pnpm webapp:validate
# Timeout: Set 120+ minutes. Runs tests, linting, typecheck.
```

### Database Commands

All database commands run via the `@shelf/database` package (`packages/database/`):

```bash
# Generate Prisma client after schema changes
pnpm db:generate

# Create a new database migration
pnpm db:prepare-migration

# Apply migrations and regenerate client
pnpm db:deploy-migration

# Reset database (destructive!)
pnpm db:reset
```

## Environment Configuration

### Critical Setup Requirements

1. **Supabase Setup** (REQUIRED):

   - Follow `apps/docs/supabase-setup.md` for complete instructions
   - Create Supabase project and get connection strings
   - Configure authentication and storage buckets
   - Update `.env` at monorepo root with actual credentials

2. **Environment Variables** (REQUIRED):
   ```bash
   DATABASE_URL="postgres://..." # Supabase connection pooling URL
   DIRECT_URL="postgres://..."   # Supabase direct connection URL
   SUPABASE_URL="https://..."    # Supabase project URL
   SUPABASE_ANON_PUBLIC="..."    # Supabase anon key
   SUPABASE_SERVICE_ROLE="..."   # Supabase service role key
   SESSION_SECRET="..."          # Random secret for sessions
   SERVER_URL="http://localhost:3000" # For local development
   ```

### Network Dependencies and Limitations

These operations require network access and will fail in restricted environments:

- `pnpm db:generate` (Prisma engine download) - **CRITICAL** for TypeScript and tests
- `pnpm --filter @shelf/webapp test:e2e:install` (Playwright browser download) - Required for E2E testing
- `pnpm install` (package downloads) - Required for initial setup
- `pnpm webapp:setup` (database migrations) - Requires valid database connection
- `pnpm webapp:dev` (development server) - Requires database connection
- `pnpm --filter @shelf/webapp precommit` (includes Prisma generate) - Will fail without network
- `pnpm webapp:validate` (includes tests requiring database) - Will fail without proper setup

**Commands that work WITHOUT network/database:**

- `pnpm turbo build` (takes ~30 seconds)
- `pnpm turbo lint` (shows existing issues)
- `pnpm --filter @shelf/webapp lint:fix` (auto-fix ESLint)
- `pnpm run format` (formats code successfully)
- `pnpm turbo typecheck` (requires Prisma types generated first)

## Validation and Testing

### Manual Validation Requirements

**ALWAYS run through complete user scenarios after making changes.** Simply starting and stopping the application is NOT sufficient validation.

### Required User Scenario Testing

Execute these workflows to validate functionality:

1. **Asset Creation Flow**:

   - Navigate to asset creation page
   - Fill in asset name and description
   - Save asset and verify creation
   - Verify QR code generation

2. **Category Management**:

   - Create new category with name and description
   - Verify category appears in listings
   - Assign category to assets

3. **Team Collaboration**:

   - Add team member to organization
   - Assign asset custody to team member
   - Release custody and verify status changes
   - Verify custody change notifications

4. **Booking System**:

   - Create booking for available assets
   - Verify conflict detection for double bookings
   - Check in/out assets from bookings
   - Generate booking PDF reports

5. **Search and Filtering**:
   - Use asset search functionality
   - Apply advanced filters (status, category, location)
   - Verify search results accuracy

### Pre-commit Validation

ALWAYS run before committing changes:

```bash
# Complete pre-commit check
pnpm --filter @shelf/webapp precommit
# Includes: prisma generate, lint:fix, format, typecheck

# Full validation (NEVER CANCEL)
pnpm webapp:validate
# Includes: tests, linting, typecheck
```

## Architecture and Key Files

### Core Technologies

- **Remix** - Full-stack React framework with file-based routing
- **TypeScript** - Type safety throughout
- **Prisma** - Database ORM with PostgreSQL
- **Supabase** - Database, authentication, and storage
- **Tailwind CSS + Radix UI** - Styling and components
- **Vitest** - Unit testing
- **Playwright** - E2E testing

### Key Directory Structure

```
shelf/
├── turbo.json                       # Turborepo pipeline config
├── pnpm-workspace.yaml              # Workspace package definitions
├── packages/
│   └── database/                    # @shelf/database — Prisma client + types
│       ├── prisma/schema.prisma     # Database schema (source of truth)
│       ├── prisma/migrations/       # Database migrations
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
│       └── test/                    # Test mocks, factories, fixtures
└── tooling/
    └── typescript/                  # Shared tsconfig bases
```

### Critical Files to Understand

1. **`packages/database/prisma/schema.prisma`** - Complete database schema and relationships
2. **`packages/database/src/client.ts`** - Database client factory (shared across apps)
3. **`apps/webapp/app/config/shelf.config.ts`** - Application configuration and constants
4. **`apps/webapp/app/modules/`** - Core business logic services (asset, booking, user, etc.)
5. **`apps/webapp/app/routes/_layout+/`** - Main authenticated application routes
6. **`apps/webapp/vite.config.ts`** - Build configuration with Remix settings
7. **`.env.example`** - Template for required environment variables

### Route Organization

- `_layout+/` - Main authenticated application routes
- `_auth+/` - Authentication and login routes
- `_welcome+/` - User onboarding flow
- `api+/` - API endpoints
- `qr+/` - QR code handling for assets

## Common Issues and Solutions

### Build Issues

- **Node version warnings**: Upgrade to 22+ recommended
- **Chunk size warnings**: Normal for large application, not errors
- **TypeScript errors**: Run `pnpm db:generate` first

### Test Issues

- **Prisma errors in tests**: Run `pnpm db:generate` before testing
- **E2E test failures**: Ensure app is running on localhost:3000
- **Network-dependent failures**: Some tests require valid database connection

### Development Issues

- **App won't start**: Verify .env configuration at monorepo root and Supabase setup
- **Database errors**: Check DATABASE_URL and DIRECT_URL in .env
- **Type errors**: Ensure Prisma types are generated via `pnpm db:generate`

## Development Workflow

1. **Make Changes**: Edit files in `apps/webapp/app/` directory
2. **Generate Types**: `pnpm db:generate` (if schema changed)
3. **Test Locally**: `pnpm webapp:test -- --run` for unit tests
4. **Lint and Format**: `pnpm --filter @shelf/webapp lint:fix && pnpm run format`
5. **Type Check**: `pnpm turbo typecheck`
6. **Manual Testing**: Run through user scenarios
7. **Pre-commit**: `pnpm --filter @shelf/webapp precommit`
8. **Full Validation**: `pnpm webapp:validate` (before major changes)

## Performance Notes

- **Build time**: ~30 seconds for production build (measured)
- **Install time**: ~60 seconds for pnpm install
- **Test suite**: ~8 seconds (unit tests only, many fail without Prisma types)
- **Lint check**: ~5 seconds (shows existing errors)
- **Format check**: ~10 seconds (works properly)
- **E2E tests**: ~5-15 minutes depending on scenarios (requires setup)

**CRITICAL**: Always set timeouts of 60+ minutes for build commands and 30+ minutes for test commands. **NEVER CANCEL** long-running operations.
