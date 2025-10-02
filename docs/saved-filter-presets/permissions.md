# Saved Asset Filter Presets – Permissions Matrix

## Overview
Saved presets are private records tied to the combination of organization and owner. The MVP keeps authorization simple by allowing only the creator (and optional organization admins via existing policies) to manage a preset. There is no organization-wide sharing yet.

## Roles & Capabilities
| Role | Can View Presets | Can Create | Can Rename | Can Delete | Notes |
| --- | --- | --- | --- | --- | --- |
| Organization Member with advanced access | Own presets | Yes (within active org) | Yes (own presets) | Yes (own presets) | Must pass `requireAdvancedModeAccess` and belong to the organization. |
| Organization Admin | Own presets | Yes | Optional: may be allowed to delete/rename any preset depending on existing admin policy. Default stance is owner-only unless explicitly enabled. |
| Other organization members | None | No | No | No | Presets are private, so other members never see them. |
| External / unauthenticated user | None | No | No | No | Blocked by session + loader guards. |

## Enforcement Points
1. **Service Layer (`asset-filter-presets/service.server.ts`)**
   - Validate `organizationId` and `ownerId` against the authenticated session.
   - Enforce owner-only mutations unless an admin override is explicitly passed in.
   - Apply per-user preset limits before writing.
2. **Loader (`assets._index` advanced loader)**
   - Filter database query to the authenticated user’s presets only.
   - Return empty array if advanced access fails or the feature flag is disabled.
3. **Action Handler (`assets._index` action)**
   - Branch on `intent` values and ensure the targeted preset belongs to the session user before rename/delete.
   - Surface `404` instead of `403` when the preset is missing or belongs to another user to avoid information leaks.
4. **Feature Flag**
   - `ENABLE_SAVED_ASSET_FILTERS` wraps loader/action logic, preventing access when the feature is not rolled out.

## Auditing
- Log `preset_created` and `preset_deleted` events with `userId` and `organizationId` to existing application logs.
- No shared visibility means we can defer more granular auditing until we introduce collaborative features.

## Future Considerations
- When organization-wide sharing is introduced, expand the matrix with visibility roles and possibly a join table for per-user favorites.
- Evaluate whether admins should inherit full control or remain scoped to owner-only operations based on customer feedback.
