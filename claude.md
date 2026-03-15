# Asset Mesh — Stealth Peanut Platform Module

## What This Is

Asset Mesh is an IT asset management module for the Stealth Peanut MSP SaaS platform. It is built as an open-source fork of [Shelf.nu](https://github.com/Shelf-nu/shelf.nu), extended with MSP-specific capabilities.

This repo (`kfulljames/shelf.nu`) is the Shelf fork being transformed into Asset Mesh. The original Asset Mesh business logic lives at `Stealth-Peanut/assetmesh-io` — that repo contains the golden record algorithm design, integration specs, and MSP-specific feature definitions that need to be merged into this codebase.

## Required Reading

Before any work, read these documents in the `docs/` directory:

1. **asset_mesh_spec.docx** — Feature decisions, integration architecture, T1/T2 visibility model, what's being added/stripped/retained from Shelf
2. **asset_mesh_migration_plan.docx** — Prisma → Supabase SQL migration strategy, model inventory (48 models, 18 enums), type mapping reference, new table schemas, RLS policy design, 8-step migration sequence, Claude Code execution brief (Section 7)

Also review the existing Asset Mesh repo (`Stealth-Peanut/assetmesh-io`) for:
- Golden record algorithm (fuzzy matching across NinjaOne/CW/Liongard)
- Integration patterns and data models
- Any existing business logic worth transplanting

## Architecture Position

```
T0 (Stealth Peanut Core)
├── Auth: Entra ID SSO (replaces Shelf native auth)
├── API proxy: All integration credentials stored here
├── Module licensing (replaces Shelf Stripe billing)
└── Tenant registry

T1 (MSP Tenant) — sees everything
├── All clients, all assets, all integration data
├── Golden record details, sync status
└── Spend analytics, QBR dashboards

T2 (Client Tenant) — scoped view
├── Own assets, custody, QR scanning, bookings
├── Cannot see: agent telemetry, sync internals, other clients
└── Auth via client's own M365/Google Workspace
```

Single Supabase database per T1 MSP. RLS policies scope T2 visibility.

## Key Decisions (Locked)

- **All IDs:** `uuid` using `gen_random_uuid()` (not Shelf's cuid text)
- **ORM:** Prisma removed entirely. Raw Supabase SQL migrations + `supabase gen types typescript`
- **Auth:** Shelf native auth stripped → Stealth Peanut T0 Entra ID SSO
- **Billing:** Shelf Stripe tiers stripped → T0 module licensing
- **Asset status:** Changed from fixed 3-value enum to configurable per-organization table
- **Person model:** First-class entity with bidirectional CW configuration item link
- **Source of truth:** This module is THE asset register. Feeds ControlMap via API.
- **Manual edit protection:** Human edits win over sync until explicitly reset (last-write-source flag per field)
- **Product name:** Asset Mesh (not Shelf)

## Current Phase

**Prisma → Supabase SQL migration** (migration plan Section 7)

Execute migration files in order:
1. `001_shelf_base_schema.sql` — Clean-state DDL from Prisma schema (all 48 models, all IDs as uuid)
2. `002_strip_shelf_billing_and_auth.sql` — Drop Tier, TierLimit, CustomTierLimit, SsoDetails, Announcement, UserBusinessIntel
3. `003_modify_for_msp.sql` — ALTER existing tables (User, Asset, Organization, TeamMember, ReportFound)
4. `004_add_msp_tables.sql` — CREATE new tables (person, software_application, license_assignment, vendor, lease, asset_sync_source, activity_log, asset_status_config)
5. `005_rls_policies.sql` — Enable RLS on all tables, create auth helper functions, T1/T2 policies
6. `006_triggers.sql` — updated_at auto-update trigger, activity_log auto-capture triggers
7. `007_supabase_features.sql` — pg_trgm extension, realtime subscriptions, storage buckets
8. `008_seed_data.sql` — Default asset statuses, system roles

## Integration Points

| System | Direction | Purpose |
|--------|-----------|---------|
| ConnectWise PSA | Bidirectional | Config items ↔ person ↔ assets. Warranty data (via ScalePad). |
| NinjaOne | Inbound (source of truth) | Device data, agent check-in, device-to-person assignment |
| Liongard | Inbound | M365 license assignments per user, tenant config |
| ControlMap | Outbound | Push asset register data for compliance frameworks |
| Stealth Peanut T0 | Auth + API proxy | All creds stored/proxied at T0. Modules never hold creds. |

## Stack

- **App:** React Router + Hono (Shelf's existing framework)
- **Database:** Supabase (PostgreSQL + RLS + Edge Functions)
- **Monorepo:** pnpm workspaces + Turborepo
- **Types:** `supabase gen types typescript` (replaces Prisma Client)
- **Deployment:** TBD (Shelf uses Fly.io, Stealth Peanut uses Vercel)

## Patterns to Follow

- **ChangeFlow** is the architectural gold standard for Stealth Peanut modules
- RLS policies follow the `auth.tenant_id()` pattern from ChangeFlow
- Integration credentials are NEVER stored in this module — always proxied via T0
- Native IDs from source systems (CW, NinjaOne, Liongard) must be preserved for write-back
- All database queries use Supabase client (supabase-js), not Prisma

## What NOT to Do

- Do not use Prisma or any ORM
- Do not store integration credentials in this module
- Do not build Stripe billing — T0 handles licensing
- Do not build native auth — T0 handles SSO
- Do not build vendor due diligence — ControlMap owns that
- Do not build asset disposal tracking — CW tickets own that
- Do not build warranty lookup — ScalePad → CW already handles it
- Do not use localStorage in any frontend artifacts
