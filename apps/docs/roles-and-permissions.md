# Roles & Permissions

Shelf has five organization roles. Every member of a workspace holds at least
one; the few who hold several are judged by the most privileged (see
_Precedence_ below).

| Role                | In plain language                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Owner**           | Created (or was handed) the workspace. Everything an Administrator can do, plus billing, add-ons, SSO/SCIM settings and transferring ownership. Exactly one per workspace.                                                                                                                                                                                                                                        |
| **Administrator**   | Runs the workspace: catalogue, settings, team, every booking and every custody assignment. Only the Owner can grant, change or revoke it.                                                                                                                                                                                                                                                                         |
| **Custody manager** | Runs bookings and custody for everyone: creates, changes, checks out and in, cancels and deletes any booking, and assigns or releases custody to anyone. Reads the catalogue, locations and team, and adds non-registered members, notes and reminders. Cannot change assets, kits, categories, settings, the team or billing, and sees only the audits assigned to them. Owners and Administrators can grant it. |
| **Self service**    | Books equipment and takes custody for themselves. Sees and changes their own bookings; sees others' bookings or custody only when the workspace allows it.                                                                                                                                                                                                                                                        |
| **Base**            | Requests bookings for themselves. Cannot take custody. Sees others' bookings or custody only when the workspace allows it.                                                                                                                                                                                                                                                                                        |

## How a decision is made

Two questions, two resolvers, both in `@shelf/permissions`:

| Question                                                                                                       | Answered by                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| May this role do _action_ on _entity_?                                                                         | the permission matrix: `userHasPermission` (client), `requirePermission` / `requireMobilePermission` (server). A member holding several roles gets the union of their grants; Owner and Administrator are allowed everything. |
| How far does this role reach? Whose bookings, whose custody, which audits, which limits, who hears about what? | the role policy table `ROLE_POLICIES`, read through `resolveRoleAccess` to a `RoleAccess` object. It reads the member's single highest-rank role and folds in the workspace's visibility toggles.                             |

Where to get it:

- **Web loaders and actions:** `const { access } = await requirePermission(…)`.
- **Mobile API:** `const { access } = await getMobileUserContext(userId, organizationId)`.
- **Web components:** `useRoleAccess()` for reach, `useOrganizationRoles()` + `userHasPermission` for the matrix.
- **Companion:** `useRoleAccess()` (`apps/companion/hooks/use-role-access.ts`) from the roles and toggles `/api/mobile/me` returns.
- **Owner-only actions:** `isWorkspaceOwner(roles)` / `access.ownsWorkspace`.
- **Prisma audiences:** `roles: { hasSome: rolesWhere((p) => p.notifications.orgBookingBroadcasts) }`.

Never compare role names in app code. The lint rule
`local-rules/no-direct-role-checks` refuses it in the webapp and the companion:
a comparison decides for the roles it names and guesses for the rest.

## Workspace visibility toggles

Settings → Bookings has four switches: _Self service can see bookings_,
_Base can see bookings_, _Self service can see custody_, _Base can see custody_.
Each widens what one role may **see**. None widens what it may **change**.

## Effective access

Rendered from the characterization fixture
(`apps/webapp/app/utils/permissions/__snapshots__/effective-access.json`).
Do not edit by hand: run `pnpm --filter @shelf/webapp docs:roles`.

<!-- BEGIN GENERATED: effective-access (pnpm --filter @shelf/webapp docs:roles) -->
<!-- prettier-ignore-start -->
**Precedence** (a member holding several roles is judged by the highest): Owner > Administrator > Custody manager > Self service > Base.

#### Reach

|  | Owner | Administrator | Custody manager | Self service | Base |
| --- | --- | --- | --- | --- | --- |
| Sees every booking (toggles off / on) | yes / yes | yes / yes | yes / yes | no / yes | no / yes |
| Sees every custodian (toggles off / on) | yes / yes | yes / yes | yes / yes | no / yes | no / yes |
| Removes booking items in | DRAFT, RESERVED, ONGOING, OVERDUE | DRAFT, RESERVED, ONGOING, OVERDUE | DRAFT, RESERVED, ONGOING, OVERDUE | DRAFT, RESERVED | DRAFT |
| Default asset index | ADVANCED | ADVANCED | ADVANCED | SIMPLE | SIMPLE |

#### Permission matrix

| Entity | Owner | Administrator | Custody manager | Self service | Base |
| --- | --- | --- | --- | --- | --- |
| `asset` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read, custody | read, custody | read |
| `assetIndexSettings` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read, update | read | read |
| `assetModel` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | None | read |
| `assetReminders` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete | None | None |
| `audit` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read, update | read, update | read, update |
| `auditNote` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read | create, read | create, read |
| `booking` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, archive, cancel, extend, manage-assets, manage-kits | create, read, update, delete, checkout, checkin, export, archive, cancel, extend, manage-assets, manage-kits | create, read, update, delete, export, manage-assets, manage-kits |
| `bookingNote` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete | create, read | create, read |
| `category` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `command-palette-search` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | read | read |
| `custody` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | None | None |
| `customField` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `dashboard` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `emailSettings` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `generalSettings` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `kit` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read, custody | read, custody | read |
| `location` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | None | None |
| `locationNote` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `nonRegisteredMember` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update | None | None |
| `note` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, delete | None | None |
| `qr` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | read | read |
| `reports` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `scan` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | None | None |
| `subscription` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `tag` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `teamMember` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | None | None |
| `teamMemberNote` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
| `teamMemberProfile` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | None | None |
| `update` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | read | read |
| `user-data` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read, update | read, update | read, update |
| `workingHours` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | read | read | read |
| `workspace` | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | create, read, update, delete, checkout, checkin, export, import, archive, cancel, extend, manage-assets, custody, manage-kits, change-role | None | None | None |
<!-- prettier-ignore-end -->
<!-- END GENERATED: effective-access -->

## Adding a role

1. Add the value to the `OrganizationRoles` enum in
   `packages/database/prisma/schema.prisma` and write the migration (`ALTER TYPE … ADD VALUE`, alone in its file).
2. Add it to `ORGANIZATION_ROLES` in `packages/permissions/src/roles.ts`; the parity check forces both sides to match.
3. Add its row to `Role2PermissionMap` (`matrix.ts`), `ROLE_POLICIES` (`policies.ts`) and `ROLE_LABELS` (`roles.ts`). All three are total records: the build fails until each has an entry.
4. If an SSO group can confer it, add an `SsoDetails` column and its entry in `SSO_GROUP_ROLE` (`apps/webapp/app/utils/sso-group-roles.ts`).
5. Regenerate the fixture and this page, and review every changed row.
