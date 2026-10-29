/**
 * Helpers for ARIA id-reference attributes.
 *
 * `aria-describedby` and `aria-labelledby` take a space-separated list of ids.
 * A dialog that shows several optional notices points at whichever are
 * rendered, and drops the attribute when none are.
 *
 * @see {@link file://./../routes/_layout+/kits.$kitId.assets.manage-assets.tsx}
 */

/**
 * Joins the ids of the elements that are present into one id-reference list.
 *
 * Pass `null`, `undefined` or `false` for an element that is not rendered.
 *
 * @param ids - Element ids, or a falsy value for each absent element
 * @returns The ids joined by spaces, or `undefined` when none are present, so
 * the attribute is left off rather than pointing at nothing
 */
export function joinAriaIds(
  ...ids: (string | null | undefined | false)[]
): string | undefined {
  const present = ids.filter((id): id is string => Boolean(id));
  return present.length > 0 ? present.join(" ") : undefined;
}
