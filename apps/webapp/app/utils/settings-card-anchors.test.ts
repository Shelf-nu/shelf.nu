/**
 * Tests for the settings card anchors.
 *
 * The ids are public URLs (`/settings/bookings#automation`), so the full list
 * is pinned: changing one here must be a deliberate decision, made knowing it
 * breaks every link already shared.
 *
 * @see {@link file://./settings-card-anchors.ts}
 */
import { describe, expect, it } from "vitest";
import {
  BOOKING_SETTINGS_ANCHORS,
  EMAIL_SETTINGS_ANCHORS,
  GENERAL_SETTINGS_ANCHORS,
} from "./settings-card-anchors";

const PAGES = {
  general: GENERAL_SETTINGS_ANCHORS,
  bookings: BOOKING_SETTINGS_ANCHORS,
  emails: EMAIL_SETTINGS_ANCHORS,
};

/** Ids the app layout already uses on every page (skip links target them). */
const LAYOUT_IDS = ["main-content", "navigation"];

describe("settings card anchors", () => {
  it("keeps every shared link working", () => {
    expect(Object.values(GENERAL_SETTINGS_ANCHORS)).toEqual([
      "general",
      "permissions",
      "sso",
      "scim",
      "transfer-ownership",
    ]);
    expect(Object.values(BOOKING_SETTINGS_ANCHORS)).toEqual([
      "notifications",
      "explicit-check-in",
      "explicit-check-out",
      "counting-options",
      "tags-requirement",
      "automation",
      "time-restrictions",
      "working-hours",
      "weekly-schedule",
      "date-overrides",
      "pdf-templates",
    ]);
    expect(Object.values(EMAIL_SETTINGS_ANCHORS)).toEqual([
      "custom-email-footer",
    ]);
  });

  it.each(Object.entries(PAGES))(
    "gives every card on /settings/%s a unique, readable id",
    (_page, anchors) => {
      const ids = Object.values(anchors);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        // Lowercase words joined by hyphens: nothing to encode in a URL.
        expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
        expect(LAYOUT_IDS).not.toContain(id);
      }
    }
  );
});
