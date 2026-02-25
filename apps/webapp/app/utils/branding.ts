/**
 * Resolves whether Shelf branding should be displayed on labels.
 *
 * @param override - Explicit preference coming from the current render context.
 * @param organizationDefault - The stored organization preference, if available.
 * @returns `true` when branding should be shown, defaulting to `true` when no
 * preference is provided.
 */
export const resolveShowShelfBranding = (
  override?: boolean,
  organizationDefault?: boolean
): boolean => {
  if (typeof override === "boolean") {
    return override;
  }

  if (typeof organizationDefault === "boolean") {
    return organizationDefault;
  }

  return true;
};
