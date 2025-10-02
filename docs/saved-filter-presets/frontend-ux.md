# Saved Asset Filter Presets – Frontend UX Flow

## Overview
Layer a lightweight preset manager onto the advanced asset index toolbar so users can store and recall their own filter combinations without copying URLs. The MVP keeps all interactions inside the existing Remix route and avoids shared/favorite concepts to reduce integration risk.

## Entry Points
1. **Toolbar Save Button** – primary action labeled “Save current filters”.
2. **Presets Menu Button** – secondary button that opens a dropdown listing the user’s presets.
3. **Empty State Callout** – inline message within the dropdown inviting users to create their first preset.

## User Flows

### Save a Preset
1. User fine-tunes filters; URL and cookies already reflect the selection via `useAdvancedSearchParams`.
2. Selecting “Save current filters” opens a modal dialog with:
   - Name input (prefilled with heuristic like `"<primary filter> preset"`).
   - Context copy clarifying presets are private to the user.
3. Submitting the form posts to the page action with `intent=createPreset`.
4. On success, the dialog closes, the dropdown list is revalidated via `fetcher.submit({ intent: 'listPresets' })`, and a toast confirms creation.
5. Validation errors (duplicate name, limit exceeded, empty field) render inline under the name input.

### Apply a Preset
1. User opens the presets menu.
2. Menu lists presets sorted alphabetically, each row showing the preset name and a secondary icon button for “More actions”.
3. Clicking the preset name navigates to `/assets?${query}` using a Remix `<Link>` so the loader naturally rehydrates filters and the cookie state stays in sync.
4. The dropdown closes automatically after navigation.

### Manage Presets
- **Rename**: Selecting “Rename” from the row’s more-actions menu opens the same modal in rename mode. On submit, post `intent=renamePreset` and refresh the list.
- **Delete**: Selecting “Delete” opens a lightweight confirmation dialog that submits `intent=deletePreset`. Success removes the item from the dropdown immediately.
- Presets remain private; there is no sharing, favorite, or pinning behavior in the MVP.

## Component Breakdown
- `AssetFilterPresetsProvider` – optional helper that exposes loader data and fetcher helpers to child components.
- `SavePresetDialog` – controlled modal reused for both create and rename flows (driven by props `mode: 'create' | 'rename'`).
- `AssetFilterPresetsMenu` – button + dropdown list; leverages existing `DropdownMenu` primitive.
- `PresetListItem` – renders a preset row with primary navigation link and an overflow menu for rename/delete.
- `DeletePresetDialog` – confirmation dialog reused from other asset flows.

## Visual Design & States
- Buttons follow design-system variants (`primary` for save, `secondary` for menu).
- Dropdown uses standard menu styling with focus rings and keyboard navigation provided by shared primitives.
- Empty state message: “No presets yet. Save your current filters to reuse them later.” plus inline “Save preset” button.
- Loading: when fetchers are busy, display a subtle spinner in the menu button and disable destructive actions.
- Error toasts reuse existing `useToast` hook for unexpected failures; validation stays inline inside dialogs.

## Accessibility
- Dialogs rely on the shared ARIA-compliant `Dialog` component.
- Dropdown items support arrow/enter/escape navigation and announce the total count for screen readers.
- Provide descriptive `aria-label` text for rename/delete buttons (e.g., “Rename preset California cameras”).

## Responsive Behavior
- On small screens the presets button collapses to an icon with tooltip; the dropdown converts to a full-width sheet to match other toolbar menus.
- Modals become full-screen on mobile with sticky footer actions to keep the submit button accessible.

## Feature Flag Handling
- Wrap the entire toolbar enhancement with `if (!flags.enableSavedAssetFilters) return null;` so we avoid rendering partially wired UI.
- The dropdown should gracefully handle an empty list both when the flag is off (loader returns empty array) and when the user has no presets.

## QA Checklist
- Create → apply → rename → delete works end-to-end without page reload issues.
- Validation messaging appears for duplicate names and limit reached.
- Keyboard-only workflow covers opening menu, selecting preset, and triggering rename/delete dialogs.
- Mobile layout keeps actions reachable and ensures dialogs are scrollable when the keyboard is visible.
