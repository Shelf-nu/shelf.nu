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

| Tool      | Version        | Install                                                      |
| --------- | -------------- | ------------------------------------------------------------ |
| Node.js   | >= 22.20.0     | `nvm install 22`                                             |
| pnpm      | 9.15.9         | `corepack enable && corepack prepare pnpm@9.15.9 --activate` |
| Xcode     | 16.4+ (stable) | App Store                                                    |
| CocoaPods | Any            | `sudo gem install cocoapods`                                 |

> **Xcode compatibility:** The project includes a `swift-concurrency-fix` Expo config plugin that automatically patches the Podfile for Xcode 16.4+ compatibility. This fixes Swift 6 strict concurrency errors in `expo-image` that prevent compilation on stable Xcode. The plugin runs automatically during `expo prebuild` — no manual steps needed.

### Quick Start

```bash
# 1. Clone and install
git clone <this-repo>
cd shelf
git checkout feat/mobile-companion-app
pnpm install

# 2. Set up webapp environment (monorepo root)
cp .env.example .env
# Fill in: DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_ANON_PUBLIC,
#          SUPABASE_SERVICE_ROLE, SESSION_SECRET

# 3. Set up companion app environment
# Get your Mac's LAN IP:
ipconfig getifaddr en0   # e.g. 192.168.1.100

cat > apps/companion/.env.local << 'EOF'
EXPO_PUBLIC_SUPABASE_URL="http://<YOUR_LAN_IP>:54321"
EXPO_PUBLIC_SUPABASE_ANON_PUBLIC="<your-supabase-anon-key>"
EXPO_PUBLIC_API_URL="http://<YOUR_LAN_IP>:3000"
EOF
# Replace <YOUR_LAN_IP> with your actual LAN IP from step above
# Get the anon key from: supabase status (Publishable key)
#
# IMPORTANT: All 3 URLs must use your LAN IP, NOT 127.0.0.1 or localhost.
# Your phone cannot reach localhost — it's a different device.
# For iOS Simulator only: localhost works fine.

# 4. Start webapp in HTTP mode (Terminal 1)
DISABLE_HTTPS=true pnpm webapp:dev
# NOTE: DISABLE_HTTPS must be a shell env var, not in .env file.
# The mobile app cannot verify self-signed HTTPS certificates.
# Alternative: rename apps/webapp/.cert to disable HTTPS.

# 5. Build and run (Terminal 2)
pnpm companion:build:ios          # For iOS Simulator
# OR
pnpm companion:build:ios:device   # For physical iPhone via USB

# 6. Subsequent launches (no rebuild needed)
pnpm companion:dev                # Start Metro, connect to existing build
pnpm companion:dev:clear          # Same but clears cache (after env changes)
```

### Available Scripts

All scripts can be run from the **monorepo root**:

| Command                           | What it does                                            |
| --------------------------------- | ------------------------------------------------------- |
| `pnpm companion:dev`              | Start Metro dev server (connects to existing build)     |
| `pnpm companion:dev:clear`        | Same but clears Metro cache (use after env var changes) |
| `pnpm companion:dev:tunnel`       | Start via Expo tunnel (when LAN connectivity fails)     |
| `pnpm companion:build:ios`        | Build native iOS + run on Simulator                     |
| `pnpm companion:build:ios:device` | Build native iOS + run on physical iPhone via USB       |
| `pnpm companion:build:android`    | Build native Android + run on emulator/device           |
| `pnpm companion:prebuild`         | Regenerate native projects from Expo config             |
| `pnpm companion:prebuild:clean`   | Clean regenerate iOS native project (wipes ios/)        |
| `pnpm companion:test:e2e`         | Run all Maestro E2E flows                               |
| `pnpm companion:test:e2e:suite`   | Run a specific E2E test suite                           |

**Typical workflow:**

1. First time: `pnpm companion:build:ios:device` (builds native app + starts Metro)
2. Subsequent launches: `pnpm companion:dev` (just starts Metro, reuses existing build)
3. After changing `.env.local`: `pnpm companion:dev:clear` (clears bundler cache)
4. After changing native code or `app.json`: rebuild with `pnpm companion:build:ios:device`

### Physical Device Setup

If testing on a real iPhone (not simulator):

1. **Enable Developer Mode** on iPhone: Settings > Privacy & Security > Developer Mode > toggle ON > restart phone
2. **Connect via USB** and select your device when Expo prompts
3. **Trust the developer profile** after first install: Settings > General > VPN & Device Management > tap your Apple ID > Trust
4. **Xcode device support**: If Xcode prompts to download support files for your iOS version, let it complete before building
5. After the first build, you only need `pnpm companion:dev` to start Metro

### Important Notes

- **Both terminals must stay open** — Terminal 1 runs the webapp, Terminal 2 runs Metro bundler
- The mobile app connects to **Supabase directly for authentication** (login/password reset) and to the **webapp API for all data operations** — that's why both URLs are needed
- If you see "Port 3000 is in use": `kill $(lsof -ti :3000)`
- If CocoaPods gives UTF-8 errors: `export LANG=en_US.UTF-8` before the expo command
- First iOS build takes ~5-10 min (compiling native code). Subsequent launches are fast
- Login with your regular Shelf account credentials
- Env vars starting with `EXPO_PUBLIC_` are baked in at Metro bundle time — restart Metro with `--clear` after changing them

### Troubleshooting

| Symptom                              | Fix                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| "Network request failed" on login    | Check `EXPO_PUBLIC_SUPABASE_URL` uses LAN IP, not 127.0.0.1                |
| "Network request failed" on data     | Check `EXPO_PUBLIC_API_URL` uses LAN IP; check webapp is running in HTTP   |
| MIME type error on phone             | Metro died — restart Terminal 2                                            |
| `AbortError: Aborted` / fetch errors | Wrong IP in `.env.local` — check with `ipconfig getifaddr en0`             |
| "Port 3000 is in use"                | `kill $(lsof -ti :3000)` then restart webapp                               |
| Stale env vars                       | Restart Metro with `--clear` flag                                          |
| "Device is busy" in Xcode            | Unplug/replug USB; run `sudo killall usbmuxd`                              |
| "Untrusted developer" on phone       | Settings > General > VPN & Device Management > Trust your profile          |
| Build errors on Xcode 16.4           | Run `cd ios && pod install` — the swift-concurrency-fix plugin should help |
| expo prebuild wiped my Podfile fix   | This is expected — the plugin re-applies automatically on each prebuild    |

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
