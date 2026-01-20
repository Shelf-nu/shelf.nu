# GitHub Copilot Instructions for Shelf.nu

**ALWAYS follow these instructions first. Only fallback to additional search and context gathering if the information here is incomplete or found to be in error.**

## Repository Overview

Shelf.nu is an open-source asset management platform built with Remix, React, TypeScript, and PostgreSQL. It provides QR code generation, asset tracking, booking management, and team collaboration features.

## Working Effectively

### Prerequisites

- **Node.js** v22+ (officially required, v20 works with warnings)
- **npm** package manager
- **Git** version control
- **Supabase account** for database and authentication
- **Network access** for dependency downloads and Prisma setup

### Bootstrap and Setup Commands

Run these commands in order. **NEVER CANCEL** any build or setup commands - they may take significant time:

```bash
# 1. Install dependencies (60+ seconds, NEVER CANCEL)
npm install
# Timeout: Set 10+ minutes. May show Node version warnings - this is expected.

# 2. Copy environment template
cp .env.example .env
# CRITICAL: You must configure .env with actual Supabase credentials before proceeding.

# 3. Generate Prisma types (requires network access)
npm run db:generate-type
# Timeout: Set 5+ minutes. NEVER CANCEL. Will fail without network access.

# 4. Setup database (requires valid DATABASE_URL in .env)
npm run setup
# Timeout: Set 10+ minutes. NEVER CANCEL. Fails without proper Supabase setup.
```

### Build Commands

**CRITICAL TIMING**: Build commands take significant time. **NEVER CANCEL**:

```bash
# Production build (30+ seconds, NEVER CANCEL)
npm run build
# Timeout: Set 60+ minutes. May show chunk size warnings - this is normal.

# Development server (requires database connection)
npm run dev
# Timeout: Set 10+ minutes for startup. Server runs on https://localhost:3000
```

### Testing Commands

**NEVER CANCEL** test commands. Set appropriate timeouts:

```bash
# Unit tests (10+ seconds, NEVER CANCEL)
npm run test
# Timeout: Set 30+ minutes. Many tests fail without Prisma types generated.

# Install E2E test browsers (requires network access, NEVER CANCEL)
npm run test:e2e:install
# Timeout: Set 60+ minutes. Downloads large browser binaries.

# E2E tests with UI (requires running app, NEVER CANCEL)
npm run test:e2e:dev
# Timeout: Set 60+ minutes. Requires app running on localhost:3000.

# E2E tests headless (requires running app, NEVER CANCEL)
npm run test:e2e:run
# Timeout: Set 60+ minutes. Includes pre-build step.
```

### Code Quality Commands

Always run before committing:

```bash
# ESLint checking (5+ seconds)
npm run lint
# Timeout: Set 10+ minutes. May show many existing errors.

# Fix ESLint issues automatically
npm run lint:fix
# Timeout: Set 10+ minutes.

# TypeScript checking (fails without Prisma types)
npm run typecheck
# Timeout: Set 10+ minutes. Requires npm run db:generate-type first.

# Format code with Prettier (10+ seconds)
npm run format
# Timeout: Set 5+ minutes.

# Complete validation pipeline (NEVER CANCEL)
npm run validate
# Timeout: Set 120+ minutes. Runs tests, linting, typecheck, and E2E tests.
```

## Environment Configuration

### Critical Setup Requirements

1. **Supabase Setup** (REQUIRED):
   - Follow `docs/supabase-setup.md` for complete instructions
   - Create Supabase project and get connection strings
   - Configure authentication and storage buckets
   - Update `.env` with actual credentials

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

- `npm run db:generate-type` (Prisma engine download) - **CRITICAL** for TypeScript and tests
- `npm run test:e2e:install` (Playwright browser download) - Required for E2E testing
- `npm install` (package downloads) - Required for initial setup
- `npm run setup` (database migrations) - Requires valid database connection
- `npm run dev` (development server) - Requires database connection
- `npm run precommit` (includes db:generate-type) - Will fail without network
- `npm run validate` (includes tests requiring database) - Will fail without proper setup

**Commands that work WITHOUT network/database:**

- `npm run build` ✅ (takes ~30 seconds)
- `npm run lint` ✅ (shows existing issues)
- `npm run lint:fix` ✅ (shows existing issues, doesn't fix automatically due to existing errors)
- `npm run format` ✅ (formats code successfully)
- `npm run typecheck` ❌ (requires Prisma types generated first)

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
npm run precommit
# Includes: db:generate-type, lint:fix, format, typecheck

# Full validation (NEVER CANCEL - takes 120+ minutes)
npm run validate
# Includes: tests, linting, typecheck, E2E tests
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
app/
├── routes/          # Remix file-based routes (using remix-flat-routes)
├── modules/         # Business logic services
├── components/      # Reusable React components
├── database/        # Prisma schema and migrations
├── atoms/           # Jotai state atoms
├── utils/           # Utility functions
└── integrations/    # Third-party service integrations

test/
├── e2e/            # Playwright E2E tests
└── fixtures/       # Test fixtures and helpers

docs/               # Comprehensive documentation
```

### Critical Files to Understand

1. **`app/database/schema.prisma`** - Complete database schema and relationships
2. **`package.json`** - All available scripts and dependencies
3. **`vite.config.ts`** - Build configuration with Remix settings
4. **`app/config/shelf.config.ts`** - Application configuration and constants
5. **`app/modules/`** - Core business logic services (asset, booking, user, etc.)
6. **`app/routes/_layout+/`** - Main authenticated application routes
7. **`.env.example`** - Template for required environment variables

### Route Organization

- `_layout+/` - Main authenticated application routes
- `_auth+/` - Authentication and login routes
- `_welcome+/` - User onboarding flow
- `api+/` - API endpoints
- `qr+/` - QR code handling for assets

## Common Issues and Solutions

### Build Issues

- **Node version warnings**: Expected with Node 20, upgrade to 22+ recommended
- **Chunk size warnings**: Normal for large application, not errors
- **TypeScript errors**: Run `npm run db:generate-type` first

### Test Issues

- **Prisma errors in tests**: Run `npm run db:generate-type` before testing
- **E2E test failures**: Ensure app is running on localhost:3000
- **Network-dependent failures**: Some tests require valid database connection

### Development Issues

- **App won't start**: Verify .env configuration and Supabase setup
- **Database errors**: Check DATABASE_URL and DIRECT_URL in .env
- **Type errors**: Ensure Prisma types are generated

## Development Workflow

1. **Make Changes**: Edit files in `app/` directory
2. **Generate Types**: `npm run db:generate-type` (if schema changed)
3. **Test Locally**: `npm run test` for unit tests
4. **Lint and Format**: `npm run lint:fix && npm run format`
5. **Type Check**: `npm run typecheck`
6. **Manual Testing**: Run through user scenarios
7. **Pre-commit**: `npm run precommit`
8. **Full Validation**: `npm run validate` (before major changes)

## Performance Notes

- **Build time**: ~30 seconds for production build (measured)
- **Install time**: ~60 seconds for npm install (with Node version warnings)
- **Test suite**: ~8 seconds (unit tests only, many fail without Prisma types)
- **Lint check**: ~5 seconds (shows existing errors)
- **Format check**: ~10 seconds (works properly)
- **E2E tests**: ~5-15 minutes depending on scenarios (requires setup)
- **Full validation**: Can take 120+ minutes with all checks (requires network and database)

**CRITICAL**: Always set timeouts of 60+ minutes for build commands and 30+ minutes for test commands. **NEVER CANCEL** long-running operations.
