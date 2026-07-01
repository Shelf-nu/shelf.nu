import type { ActivityEventInput } from "~/modules/activity-event/types";

/**
 * Factory for creating `ActivityEventInput` test payloads.
 *
 * Defaults to a `BOOKING_ASSETS_ADDED` shape — the canonical bulk case
 * exercised by `recordEvents` — so callers only override the fields that
 * matter to a given assertion (e.g. `actorUserId`, `assetId`).
 */
export function createActivityEventInput(
  overrides: Partial<ActivityEventInput> = {}
): ActivityEventInput {
  return {
    organizationId: "org-1",
    actorUserId: "user-1",
    action: "BOOKING_ASSETS_ADDED",
    entityType: "BOOKING",
    entityId: "booking-1",
    bookingId: "booking-1",
    assetId: "asset-1",
    ...overrides,
  } as ActivityEventInput;
}
