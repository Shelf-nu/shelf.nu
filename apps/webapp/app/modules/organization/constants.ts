/**
 * Organization-related constants shared across the webapp.
 *
 * @see {@link file://./../../routes/api+/user.change-current-organization.ts}
 */

/**
 * Action path for the "switch current organization" submission.
 *
 * Both call sites — the sidebar workspace selector and the 404 "wrong
 * workspace" handler — post here as a **native document submission**
 * (`reloadDocument`), never through a fetcher. Switching workspace swaps the
 * whole tenant, so the document is rebuilt for the new workspace rather than
 * patched by router revalidation, which can leave the app shell (sidebar nav,
 * roles) on the previous workspace.
 *
 * @see {@link file://./../../components/layout/sidebar/organization-selector.tsx}
 * @see {@link file://./../../components/errors/error-404-handler.tsx}
 */
export const CHANGE_CURRENT_ORGANIZATION_ACTION =
  "/api/user/change-current-organization";
