# Saved Asset Filter Presets – Frontend UX Flow

## Overview
Enhance the advanced asset index toolbar with controls to save, apply, and manage filter presets. The flow reuses Remix loader data and fetchers to keep state consistent without introducing client-side stores beyond existing hooks.

## Entry Points
1. **Toolbar Actions**
   - `Save current filters` primary button.
   - `Presets` menu button showing saved filters, grouped by visibility (shared vs. personal).
2. **Keyboard Shortcuts** (future): placeholder for quick access, not in MVP.

## User Stories & Flows

### Save a Preset
1. User configures filters; URL and cookies update via `useAdvancedSearchParams`.
2. Clicking `Save current filters` opens a modal (`<Dialog>` component) with:
   - Name input (pre-populated with heuristic like `${primaryFilter} preset`).
   - Toggle `Share with organization` (default off).
3. Submitting form posts to `POST /api/asset-filter-presets` via `useFetcher`.
4. On success, modal closes, toast “Preset saved” shows, presets revalidate.
5. On error, inline form errors display under relevant fields.

### Apply a Preset
1. User opens `Presets` menu.
2. Menu lists presets grouped:
   - Shared with organization (alphabetical).
   - My presets (alphabetical or last used).
3. Selecting a preset triggers navigation to `/assets?${query}&view=${view}` using Remix `<Link>` to ensure full reload of loader.
4. After navigation completes, a background `fetcher.submit` posts to the apply endpoint to update `lastUsedAt`; no redirect is expected in the response.

### Manage Presets
- **Rename**: Inline action opens small modal, `PUT` request with new name. On success revalidate presets list.
- **Delete**: Confirmation dialog (reuse existing `ConfirmDialog` component) before sending `DELETE` request.
- **Toggle Sharing**: Checkbox or switch toggles via `PUT` with `isShared`. Sharing state affects grouping for other members.

## Component Breakdown
- `AssetFilterPresetsProvider` (new hook) reading loader data and exposing helpers.
- `AssetFilterPresetsMenu` – menu button + list UI.
- `SavePresetDialog` – controlled by provider state.
- `RenamePresetDialog` – reused for rename flow.
- `DeletePresetDialog` – confirm deletion.
- `PresetListItem` – row showing name, owner (if shared), actions.

## Visual Design & States
- Buttons follow design system `Button` variants (`primary` for save, `secondary` for menu).
- Menu uses `DropdownMenu` component with section headers.
- Loading states: spinner within dialog buttons while fetchers busy.
- Empty state: message “No presets yet. Save one to get started.” with CTA button.
- Error state: inline `FormError` component surfaces `ShelfError` message.

## Accessibility
- Dialogs use ARIA-compliant `Dialog` component already in app.
- Menu items support keyboard navigation (arrow keys, enter, escape).
- Announce success via toast accessible text.
- Provide `aria-label` for action icons (e.g., “Delete preset”).

## Responsive Behavior
- On small screens, toolbar collapses; `Presets` button becomes icon-only with tooltip.
- Dialogs occupy full width on mobile (<640px) with sticky submit bar.

## Data Dependencies
- Loader must supply `savedPresets`, `limit`, and `canShare` (derived from permissions).
- Feature flag check wraps the entire UI (`if (!flags.enableSavedAssetFilters) return null`).

## Analytics Hooks
- Fire `analytics.track('preset_saved', { presetId })` on success.
- Track menu open, preset apply actions, and sharing toggles for usage metrics.

## QA Checklist
- Verify saving applies sanitized query by reloading page and confirming filter state.
- Ensure rename/delete/share actions respect permissions.
- Test with >10 presets to ensure scrollable menu layout remains usable.
- Validate keyboard-only workflow end-to-end.
