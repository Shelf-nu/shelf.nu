/**
 * Guards the webapp half of the shared-tone contract.
 *
 * `@shelf/labels` decides which tone a status carries; this app decides what
 * each tone looks like. A tone the resolver does not know about returns
 * `undefined`, which renders as an unstyled badge rather than throwing — so
 * "every tone and every status resolves to a real colour pair" is asserted
 * here rather than left to the type checker.
 *
 * @see {@link file://./status-tone-colors.ts}
 */
import {
  AUDIT_ASSET_STATUS_TONES,
  AUDIT_STATUS_TONES,
  type StatusTone,
} from "@shelf/labels";
import { describe, expect, it } from "vitest";

import { BADGE_COLORS } from "./badge-colors";
import { toneBadgeColors } from "./status-tone-colors";

/** Every tone the shared package can hand this app. */
const ALL_TONES: StatusTone[] = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
];

describe("toneBadgeColors", () => {
  it.each(ALL_TONES)(
    "resolves %s to a background and a text colour",
    (tone) => {
      const colors = toneBadgeColors(tone);

      expect(colors?.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(colors?.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  );

  it("resolves every audit status the shared package knows about", () => {
    const tones = [
      ...Object.values(AUDIT_STATUS_TONES),
      ...Object.values(AUDIT_ASSET_STATUS_TONES),
    ];

    for (const tone of tones) {
      expect(toneBadgeColors(tone)).toBeDefined();
    }
  });

  it("paints a missing asset red and an unexpected one amber", () => {
    // The pairing users read as "act on this" vs "file this correctly". It is
    // the decision the shared tones exist to hold still, so it is pinned on
    // this side of the mapping too.
    expect(toneBadgeColors(AUDIT_ASSET_STATUS_TONES.MISSING)).toEqual(
      BADGE_COLORS.red
    );
    expect(toneBadgeColors(AUDIT_ASSET_STATUS_TONES.UNEXPECTED)).toEqual(
      BADGE_COLORS.amber
    );
  });
});
