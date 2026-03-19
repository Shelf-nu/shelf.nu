# Shelf Companion App

> **Status:** Under review — ready for local testing
> **Branch:** `feat/mobile-companion-app` (162 files, ~33k lines)
> **Decision needed:** Where should this code live? See [Architecture Decision](#architecture-decision-monorepo-vs-separate-repo) below.

---

## What Is This?

A native iOS/Android companion app for [Shelf.nu](https://shelf.nu) built with **Expo SDK 54 + React Native + TypeScript**. It gives field teams mobile access to assets, scanning, audits, and bookings — all powered by the existing Shelf webapp backend.

### Features

| Feature                  | Description                                                                     |
| ------------------------ | ------------------------------------------------------------------------------- |
| **QR + Barcode Scanner** | Scans Shelf QR codes, Code128, Code39, EAN-13, DataMatrix — resolves to assets  |
| **Asset Management**     | List, search, filter, create, edit assets with image upload                     |
| **Audits**               | View audits, scan assets (QR + barcode), mark found/unexpected, complete audits |
| **Bookings**             | List, filter by status, checkout/checkin flows                                  |
| **Custody**              | Assign/release custody with bulk operations                                     |
| **Dashboard**            | Stats overview, pull-to-refresh, quick actions                                  |
| **Dark Mode**            | Full theme support with system preference detection                             |
| **Offline Support**      | Network detection, cached API responses, offline audit persistence              |
| **E2E Tests**            | 40+ Maestro test flows covering all features                                    |

### How Authentication Works

```
Mobile App ──(email/password)──> Supabase Auth ──> JWT token
Mobile App ──(Bearer JWT)──────> Shelf API (/api/mobile/*) ──> Prisma DB
```

- The app authenticates directly with **Supabase Auth** (same project as the webapp)
- API calls go to **27 new endpoints** inside the existing Shelf webapp (`/api/mobile/*`)
- These endpoints use **JWT Bearer auth** (not cookies), validated server-side via `supabase.auth.getUser(token)`
- No new database, no new auth system — reuses everything that exists

### What Changed in the Webapp

| File                                                     | Change                 | Why                                                                  |
| -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| `apps/webapp/app/routes/api+/mobile.*.ts`                | 27 new API route files | JWT-authenticated endpoints for mobile consumption                   |
| `apps/webapp/app/modules/api/mobile-auth.server.ts`      | New module             | `requireMobileAuth()` + `requireOrganizationAccess()` helpers        |
| `apps/webapp/server/index.ts`                            | +1 line                | CSRF exclusion for `/api/mobile/*` (JWT auth, not cookies)           |
| `apps/webapp/vite.config.ts`                             | ~10 lines              | HTTPS made optional when cert files don't exist (needed for LAN dev) |
| `apps/webapp/app/modules/barcode/service.server.test.ts` | +2 tests               | Custom include param + case-insensitive matching                     |

All changes are **additive** — no existing webapp behavior is modified.

---

## Architecture Decision: Monorepo vs Separate Repo

This is the key decision to make before merging.

### Option A: Keep in Monorepo (Recommended)

The mobile app currently lives at `apps/companion/` alongside `apps/webapp/` and `apps/docs/`.

**Pros:**

- Mobile API routes and webapp code are in the same repo — atomic PRs that change both
- Shared TypeScript types between mobile endpoints and mobile app (future)
- `@shelf/database` Prisma types are immediately available
- Single `pnpm install` sets up everything
- Turborepo already orchestrates builds across apps
- Root `package.json` already has `mobile:dev`, `mobile:ios`, etc. scripts

**Cons:**

- Larger repo for contributors who only work on the webapp
- CI pipeline needs to be aware of mobile changes
- `pnpm-lock.yaml` grows (React Native adds ~6k lines)

**What this looks like:**

```
shelf.nu/
├── apps/
│   ├── webapp/          # Existing Remix webapp
│   ├── mobile/          # NEW: Companion app
│   └── docs/            # Existing docs site
├── packages/
│   └── database/        # Shared Prisma schema
└── turbo.json           # Orchestrates all apps
```

### Option B: Separate Repository

Extract `apps/companion/` into its own repo. The webapp API routes stay in the main repo.

**Pros:**

- Clean separation — mobile team has their own repo
- Webapp repo stays unchanged in size
- Independent release cycles

**Cons:**

- API contract changes require coordinated PRs across two repos
- No shared types — mobile app types must be manually kept in sync
- Separate dependency management, CI/CD setup
- Need to copy/reference the 27 API routes separately
- Testing mobile + webapp changes together requires checking out both repos

### Our Recommendation

**Option A (monorepo)** — the mobile app is tightly coupled to the webapp's API routes. Having them in the same repo means:

- A single PR can add a new mobile screen AND its API endpoint
- TypeScript catches breaking changes at compile time
- No coordination overhead between repos

The monorepo approach is what Expo recommends for apps that share a backend.

---

## Local Development Setup

### Prerequisites

| Tool      | Version    | Install                                                      |
| --------- | ---------- | ------------------------------------------------------------ |
| Node.js   | >= 22.20.0 | `nvm install 22`                                             |
| pnpm      | 9.15.9     | `corepack enable && corepack prepare pnpm@9.15.9 --activate` |
| Xcode     | Latest     | App Store                                                    |
| CocoaPods | Any        | `sudo gem install cocoapods`                                 |

### Quick Start

```bash
# 1. Clone and install
git clone <this-repo>
cd shelf-companion-app
git checkout feat/mobile-companion-app
pnpm install

# 2. Set up webapp environment (monorepo root)
cp .env.example .env
# Fill in: DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_ANON_PUBLIC,
#          SUPABASE_SERVICE_ROLE, SESSION_SECRET
# (Ask Carlos for the dev values)

# 3. Set up mobile environment
cat > apps/companion/.env.local << 'EOF'
EXPO_PUBLIC_SUPABASE_URL="https://luouuvatmygcrxkhcxmg.supabase.co"
EXPO_PUBLIC_SUPABASE_ANON_PUBLIC="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1b3V1dmF0bXlnY3J4a2hjeG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NzYzODI4MjYsImV4cCI6MTk5MTk1ODgyNn0.KN7sOuHn1tZzQEUX0miNKWSYA2w13C31jume0EIFk0E"
EXPO_PUBLIC_API_URL=http://<YOUR_LOCAL_IP>:3000
EOF
# Replace <YOUR_LOCAL_IP> with: ipconfig getifaddr en0
# If using iOS Simulator, use: http://localhost:3000

# 4. Start webapp (Terminal 1)
pnpm webapp:dev
# Wait for "VITE ready" on port 3000

# 5. Start mobile (Terminal 2)
cd apps/companion
npx expo run:ios --clear          # For iOS Simulator
# OR
npx expo run:ios --device --clear  # For physical iPhone via USB
```

### Important Notes

- **Both terminals must stay open** — Terminal 2 runs Metro bundler + USB tunnel
- If you see "Port 3000 is in use": `kill $(lsof -ti :3000)`
- If CocoaPods gives UTF-8 errors: `export LANG=en_US.UTF-8` before the expo command
- First iOS build takes ~5-10 min (compiling native code). Subsequent launches are fast
- Login with your regular Shelf account credentials

### Troubleshooting

| Symptom                              | Fix                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| MIME type error on phone             | Metro died — restart Terminal 2                                |
| `AbortError: Aborted` / fetch errors | Wrong IP in `.env.local` — check with `ipconfig getifaddr en0` |
| "Port 3000 is in use"                | `kill $(lsof -ti :3000)` then restart webapp                   |
| Stale env vars                       | Restart Metro with `--clear` flag                              |

---

## Project Structure

```
apps/companion/
├── app/                    # Expo Router file-based routes
│   ├── (auth)/             # Login, forgot password
│   ├── (tabs)/             # Main app tabs
│   │   ├── assets/         # Asset list, detail, create, edit
│   │   ├── audits/         # Audit list, detail, scan flow
│   │   ├── bookings/       # Booking list, detail, checkout/checkin
│   │   ├── scanner.tsx     # QR + barcode scanner
│   │   ├── home.tsx        # Dashboard
│   │   ├── custody.tsx     # Custody management
│   │   └── settings.tsx    # Theme, org switch, logout
│   └── _layout.tsx         # Root layout with providers
├── components/             # Shared UI components
├── lib/                    # Core libraries
│   ├── api.ts              # API client (fetch, cache, types)
│   ├── auth-context.tsx    # Auth provider (Supabase)
│   ├── supabase.ts         # Supabase client + SecureStore
│   ├── org-context.tsx     # Organization provider
│   ├── qr-utils.ts         # QR code ID extraction
│   └── theme-context.tsx   # Dark mode provider
├── .maestro/               # E2E test flows (Maestro)
├── ios/                    # Native iOS project (generated)
├── app.json                # Expo config
├── metro.config.js         # Metro bundler config (monorepo)
└── package.json            # Dependencies
```

---

## API Endpoints (27 routes)

All at `/api/mobile/*` — JWT Bearer auth required.

| Endpoint                               | Method | Description                             |
| -------------------------------------- | ------ | --------------------------------------- |
| `/api/mobile/me`                       | GET    | User profile + organizations            |
| `/api/mobile/dashboard`                | GET    | Home stats                              |
| `/api/mobile/assets`                   | GET    | Paginated asset list with search/filter |
| `/api/mobile/assets/:assetId`          | GET    | Asset detail                            |
| `/api/mobile/asset/create`             | POST   | Create new asset                        |
| `/api/mobile/asset/update`             | POST   | Update asset fields                     |
| `/api/mobile/asset/update-image`       | POST   | Upload asset image                      |
| `/api/mobile/asset/update-location`    | POST   | Update asset location                   |
| `/api/mobile/asset/add-note`           | POST   | Add note to asset                       |
| `/api/mobile/qr/:qrId`                 | GET    | Resolve QR code to asset                |
| `/api/mobile/barcode/:value`           | GET    | Resolve barcode to asset                |
| `/api/mobile/audits`                   | GET    | Audit list                              |
| `/api/mobile/audits/:auditId`          | GET    | Audit detail with scans                 |
| `/api/mobile/audits/record-scan`       | POST   | Record audit scan                       |
| `/api/mobile/audits/complete`          | POST   | Complete audit                          |
| `/api/mobile/bookings`                 | GET    | Booking list                            |
| `/api/mobile/bookings/:bookingId`      | GET    | Booking detail                          |
| `/api/mobile/bookings/checkout`        | POST   | Checkout booking                        |
| `/api/mobile/bookings/checkin`         | POST   | Checkin booking                         |
| `/api/mobile/bookings/partial-checkin` | POST   | Partial checkin                         |
| `/api/mobile/custody/assign`           | POST   | Assign custody                          |
| `/api/mobile/custody/release`          | POST   | Release custody                         |
| `/api/mobile/bulk-assign-custody`      | POST   | Bulk assign custody                     |
| `/api/mobile/bulk-release-custody`     | POST   | Bulk release custody                    |
| `/api/mobile/bulk-update-location`     | POST   | Bulk update location                    |
| `/api/mobile/categories`               | GET    | Category list (cached)                  |
| `/api/mobile/locations`                | GET    | Location list (cached)                  |
| `/api/mobile/team-members`             | GET    | Team member list (cached)               |

---

## Tech Stack

| Layer      | Technology                        |
| ---------- | --------------------------------- |
| Framework  | Expo SDK 54 + React Native 0.81   |
| Routing    | Expo Router 6 (file-based)        |
| Language   | TypeScript 5.9                    |
| Auth       | Supabase Auth + SecureStore       |
| State      | React Context (auth, org, theme)  |
| API Client | Custom fetch wrapper with caching |
| Scanner    | expo-camera (QR + barcode types)  |
| E2E Tests  | Maestro                           |
| iOS Min    | iOS 15.1                          |
| Node       | >= 22.20.0                        |
