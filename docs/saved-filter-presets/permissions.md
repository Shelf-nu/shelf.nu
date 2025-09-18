# Saved Asset Filter Presets – Permissions Matrix

## Overview
Saved presets operate within an organization context and must respect existing Shelf authorization helpers. This matrix documents who can perform which actions.

## Roles & Capabilities
| Role | Can View Presets | Can Create | Can Rename | Can Delete | Can Share | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Organization Member (Advanced access) | Own presets + shared presets | Yes (own org) | Yes (own presets) | Yes (own presets) | No | Base requirement: must pass `requireAdvancedModeAccess` check. |
| Organization Admin | All presets in org | Yes | Yes (any preset) | Yes (any preset) | Yes | Admins may manage shared presets on behalf of others. |
| Owner of preset | Own + shared | Yes | Yes | Yes | Yes (toggle) | Ownership stored via `ownerId`. |
| Shared recipient | Shared presets | No | No | No | No | Apply-only rights. |
| External / other org user | None | No | No | No | No | Access blocked during loader/action guard. |

## Enforcement Points
1. **Service Layer (`asset-filter-presets/service.server.ts`)**
   - `requireOrganizationMembership` to ensure organization context is valid.
   - `ensureAdvancedAccess` (wrapper around existing advanced mode guard).
   - Ownership checks before rename/delete unless user is admin (use `userHasRole('admin')`).

2. **Loader (`assets._index` advanced loader)**
   - Filter results to presets that are either owned by user or shared (`isShared = true`).
   - Include admin-managed presets for admin users.

3. **API Routes**
   - `create`: set `ownerId` = session user; reject if user lacks advanced access.
   - `update/delete`: ensure `preset.organizationId === session.organizationId` and either `preset.ownerId === session.userId` or `session.isAdmin`.

4. **Feature Flag**
   - Wrap loader/action UI behind `ENABLE_SAVED_ASSET_FILTERS`. Flag check occurs after permissions to avoid leaking presence of feature to unauthorized users.

## Auditing
- Log every create/update/delete with `userId`, `organizationId`, `presetId`.
- Consider exposing audit log entry in admin console (future).

## Future Considerations
- If presets become shareable across organizations, introduce ACL table with explicit grants.
- Support per-preset viewer list by expanding schema (not part of MVP).
