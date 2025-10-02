# Saved Asset Filter Presets – Action Contract

## Overview
The MVP reuses the existing advanced asset index Remix route (`app/routes/_layout+/assets._index.tsx`) for every preset operation. Instead of creating new API routes, the page action handles discriminated form submissions identified by an `intent` field. All requests originate from Remix forms or fetchers, inheriting CSRF protection and the current authenticated session.

## Shared Requirements
- Session user must belong to the active organization and have advanced asset index access (validated by existing loader guard).
- Every submission includes `intent` plus the fields listed below. Payloads may be submitted as standard form posts (`application/x-www-form-urlencoded`) or `FormData` when using fetchers.
- Responses are JSON payloads with shape `{ presetActionResult }` alongside HTTP status codes mirroring existing Remix error helpers.
- When the feature flag `ENABLE_SAVED_ASSET_FILTERS` is disabled, the action rejects preset intents with `404` to avoid leaking the feature.

## Intents

### `intent=createPreset`
Creates a preset owned by the submitting user.

**Fields**
- `name` (string, required, trimmed, 1–60 chars)
- `query` (string, required) – sanitized query string taken from `cleanParamsForCookie`.
- `view` (string, required) – current advanced view (`table`, `availability`, etc.).

**Responses**
- `201 Created` with
  ```json
  {
    "presetActionResult": {
      "preset": {
        "id": "cuid123",
        "name": "California cameras",
        "query": "category=camera&location=ca",
        "view": "table"
      },
      "presets": [ /* refreshed list for UI */ ]
    }
  }
  ```
- `400 Bad Request` with validation message when the name is empty, exceeds 60 characters, duplicates an existing preset (case-insensitive), or the per-user limit (20) has been reached.
- `403 Forbidden` if the user no longer has advanced access for the organization.

### `intent=renamePreset`
Renames an existing preset owned by the submitting user.

**Fields**
- `presetId` (string, required)
- `name` (string, required, 1–60 chars)

**Responses**
- `200 OK` with updated preset list.
- `404 Not Found` if the preset does not belong to the user or organization.
- `409 Conflict` when the new name collides with another preset owned by the user.

### `intent=deletePreset`
Deletes a preset owned by the submitting user.

**Fields**
- `presetId` (string, required)

**Responses**
- `200 OK` with refreshed preset list after removal.
- `404 Not Found` if the preset is missing or owned by another user.

### `intent=listPresets` (internal refresh)
Fetches the latest presets without mutating data. Used by `useFetcher` after successful actions to refresh UI state.

**Fields**
- none beyond `intent`

**Responses**
- `200 OK` with `presets` array.

## Loader Contract
When the action succeeds or the page loads, the loader returns:
```json
{
  "savedPresets": [
    {
      "id": "cuid123",
      "name": "California cameras",
      "query": "category=camera&location=ca",
      "view": "table"
    }
  ],
  "presetLimit": 20
}
```
If the feature flag is off or the user lacks advanced access, `savedPresets` is an empty array and `presetLimit` is omitted.

## Error Envelope
Errors reuse the existing `ShelfError` JSON format:
```json
{
  "error": {
    "message": "Preset name already exists",
    "code": "PRESET_DUPLICATE_NAME"
  }
}
```

## Telemetry
For the MVP, log events using existing server-side logger hooks when `createPreset` or `deletePreset` succeeds. Additional analytics can be layered on later without contract changes.
