/**
 * Tag "use for" picker options.
 *
 * `TagUseFor` reaches the user in two places on one form: the dropdown of
 * everything available, and the chips for what the tag already carries. Both are
 * built from here so a label cannot be formatted in one and left raw in the
 * other.
 *
 * @see {@link file://./../../routes/_layout+/tags.$tagId_.edit.tsx}
 * @see {@link file://./../../routes/_layout+/tags.new.tsx}
 */
import { TagUseFor } from "@prisma/client";

import { formatEnum } from "~/utils/misc";

/** One entry in the use-for picker. */
export type TagUseForOption = {
  label: string;
  value: TagUseFor;
};

/**
 * Every use-for the schema defines, labelled for display.
 *
 * @returns The full option list, in schema order
 */
export function tagUseForOptions(): TagUseForOption[] {
  return Object.values(TagUseFor).map((value) => ({
    label: formatEnum(value),
    value,
  }));
}

/**
 * The options a tag already carries, labelled identically to the dropdown.
 *
 * Filtering the option list rather than mapping the stored values does two
 * things: the chips read in the picker's order whatever order the column holds,
 * and a stored value the schema no longer defines is dropped instead of becoming
 * a chip nothing can match.
 *
 * @param useFor - The values stored on the tag
 * @returns The matching options, in the picker's order
 */
export function selectedTagUseForOptions(
  useFor: TagUseFor[]
): TagUseForOption[] {
  const stored = new Set<string>(useFor);

  return tagUseForOptions().filter((option) => stored.has(option.value));
}
