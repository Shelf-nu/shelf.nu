/**
 * Tag "use for" picker options.
 *
 * The dropdown and the already-selected chips are two views of one list, so the
 * thing worth pinning is that they agree: a label built in one place and not the
 * other is how the chips ended up showing raw enum values.
 *
 * @see {@link file://./use-for-options.ts}
 */
import { TagUseFor } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { selectedTagUseForOptions, tagUseForOptions } from "./use-for-options";

describe("tagUseForOptions", () => {
  it("offers every use-for the schema defines", () => {
    expect(tagUseForOptions().map((option) => option.value)).toEqual(
      Object.values(TagUseFor)
    );
  });

  it("labels for display rather than exposing the enum", () => {
    for (const option of tagUseForOptions()) {
      expect(option.label).not.toBe(option.value);
      expect(option.label).toBe(
        option.value.charAt(0) + option.value.slice(1).toLowerCase()
      );
    }
  });
});

describe("selectedTagUseForOptions", () => {
  it("labels a selection exactly as the dropdown labels it", () => {
    const selected = selectedTagUseForOptions([TagUseFor.ASSET]);
    const fromDropdown = tagUseForOptions().find(
      (option) => option.value === TagUseFor.ASSET
    );

    expect(selected).toEqual([fromDropdown]);
  });

  it("answers empty for a tag with no use-for", () => {
    expect(selectedTagUseForOptions([])).toEqual([]);
  });

  it("keeps the dropdown's order, not the stored order", () => {
    // A stored array can be in any order; the chips should still read in the
    // order the picker lists them.
    const all = Object.values(TagUseFor);
    const reversed = [...all].reverse();

    expect(selectedTagUseForOptions(reversed).map((o) => o.value)).toEqual(all);
  });

  it("ignores a stored value the schema no longer defines", () => {
    // Enum members get removed; a tag row written before that should not put an
    // unlabelled chip on the form.
    const stored = [TagUseFor.ASSET, "RETIRED" as TagUseFor];

    expect(selectedTagUseForOptions(stored).map((o) => o.value)).toEqual([
      TagUseFor.ASSET,
    ]);
  });
});
