/**
 * Organization-related constants shared across the webapp.
 *
 * @see {@link file://./../../routes/api+/user.change-current-organization.ts}
 */

/**
 * Action path for the "switch current organization" fetcher submission.
 *
 * Used by the org selector to POST a switch and by `_layout.tsx` to detect
 * in-flight workspace switches via `useFetchers()`. Keep both sides pointing
 * at this constant so renaming the route doesn't silently break the loading
 * state.
 */
export const CHANGE_CURRENT_ORGANIZATION_ACTION =
  "/api/user/change-current-organization";
