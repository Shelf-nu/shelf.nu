/**
 * Tests for the settings card anchors.
 *
 * The ids are public URLs (`/settings/bookings#automation`), so the full list
 * is pinned: changing one here must be a deliberate decision, made knowing it
 * breaks every link already shared. A second check reads the components from
 * disk and makes sure each id is given to exactly one card, so a card wired
 * to its neighbour's constant (or to none) fails here instead of opening the
 * wrong card.
 *
 * @see {@link file://./settings-card-anchors.ts}
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
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

const APP_DIR = path.resolve(__dirname, "..");

/** Every `.tsx` file under `app/` that is not a test, relative to `app/`. */
function componentFiles(): string[] {
  return readdirSync(APP_DIR, { recursive: true, encoding: "utf8" }).filter(
    (file) => file.endsWith(".tsx") && !/\.test\.tsx$/.test(file)
  );
}

/** Where each anchor constant is given to an element as its `id`. */
function anchorIdUsages(): Map<string, Set<string>> {
  const usages = new Map<string, Set<string>>();
  const pattern = /id=\{(GENERAL|BOOKING|EMAIL)_SETTINGS_ANCHORS\.(\w+)\}/g;
  for (const file of componentFiles()) {
    const source = readFileSync(path.join(APP_DIR, file), "utf8");
    for (const [, page, key] of source.matchAll(pattern)) {
      const name = `${page}.${key}`;
      usages.set(name, (usages.get(name) ?? new Set()).add(file));
    }
  }
  return usages;
}

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

  it("gives each id to exactly one card", () => {
    const usages = anchorIdUsages();
    const expected = [
      ...Object.keys(GENERAL_SETTINGS_ANCHORS).map((k) => `GENERAL.${k}`),
      ...Object.keys(BOOKING_SETTINGS_ANCHORS).map((k) => `BOOKING.${k}`),
      ...Object.keys(EMAIL_SETTINGS_ANCHORS).map((k) => `EMAIL.${k}`),
    ];

    // Every id is used, and nothing outside the lists is.
    expect([...usages.keys()].sort()).toEqual(expected.sort());
    // One component per id. A component may repeat it in branches that
    // never render together (the transfer-ownership card's three states).
    for (const [name, files] of usages) {
      expect({ name, files: [...files] }).toEqual({
        name,
        files: [expect.any(String)],
      });
    }
  });
});
