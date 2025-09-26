# Saved Asset Filter Presets – API Contract

## Overview
The Remix app will expose REST-style actions for CRUD operations on asset filter presets. Endpoints operate within the context of the authenticated session and current organization. All requests require CSRF-safe Remix form submissions or authenticated fetcher calls.

## Base URL
`/api/asset-filter-presets`

## Authentication & Authorization
- Session must include a user with access to the active organization and advanced asset index permissions.
- Actions validate that the preset belongs to the same organization as the session.
- Shared presets (`isShared = true`) are readable by any advanced-mode member of the organization, but only the owner or an org admin can modify/delete them.

## Endpoints

### GET `/api/asset-filter-presets`
Returns presets visible to the current user.

**Query Parameters**
- `mode` (optional) – defaults to `ADVANCED`; reserved for future use.

**Response 200**
```json
{
  "presets": [
    {
      "id": "cuid123",
      "name": "California cameras",
      "query": "category=camera&location=ca",
      "view": "table",
      "mode": "ADVANCED",
      "isShared": false,
      "owner": {
        "id": "user123",
        "name": "Alex Johnson"
      },
      "lastUsedAt": "2024-05-02T18:30:00.000Z"
    }
  ],
  "limit": 20
}
```

### POST `/api/asset-filter-presets`
Creates a new preset for the current user.

**Request Body (JSON or Remix form data)**
- `name` (string, 1–80 chars)
- `query` (string, sanitized query string from URL)
- `view` (string, required)
- `mode` (string enum, default `ADVANCED`)
- `isShared` (boolean, default `false`)

**Responses**
- `201 Created` with body `{ "preset": { ... } }`
- `400 Bad Request` on validation failure (duplicate name, over limit, empty query).
- `403 Forbidden` if user lacks permissions.

### PUT `/api/asset-filter-presets/:presetId`
Updates preset metadata (rename or toggle sharing).

**Request Body**
- Optional fields: `name`, `isShared`.
- At least one field required.

**Responses**
- `200 OK` with updated preset payload.
- `404 Not Found` if preset not visible to user.
- `409 Conflict` if new name collides with existing preset.

### DELETE `/api/asset-filter-presets/:presetId`
Deletes a preset. Only owner or org admin may delete.

**Responses**
- `204 No Content` on success.
- `404 Not Found` if preset not owned/visible.

### POST `/api/asset-filter-presets/:presetId/apply`
Updates `lastUsedAt` for analytics/order tracking after a preset is applied client-side.

**Responses**
- `204 No Content` when timestamp update (or throttled no-op) succeeds.
- `404 Not Found` if preset is not visible to the user.

## Errors
All errors follow existing `ShelfError` JSON envelope:
```json
{
  "error": {
    "message": "Preset name already exists",
    "code": "PRESET_DUPLICATE_NAME"
  }
}
```

## Rate Limiting & Limits
- Creation fails with `400` and code `PRESET_LIMIT_REACHED` once user hits 20 presets.
- Apply endpoint may be hit frequently; throttle internal updates to only write when timestamp delta >5 minutes.

## Versioning
- Endpoints live under `api+/` Remix routes to enable gradual evolution.
- `mode` parameter allows extension to other filter contexts without breaking clients.

## Telemetry
- Emit log events (`preset_created`, `preset_applied`, `preset_deleted`) with preset id, organizationId, ownerId.
- Hook into existing analytics pipeline if available.
