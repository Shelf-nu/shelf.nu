/**
 * Assets Filter Link
 *
 * Wraps a chip (a category badge, a tag) in a link to the asset index filtered
 * to that one value. Links are written in the simple filter grammar
 * (`?category=<id>`, `?tag=<id>`), which the advanced index also reads: see
 * `normalizeAdvancedFilterParams` in `utils/cookies.server.ts`.
 *
 * @see {@link file://./category-badge.tsx}
 * @see {@link file://./assets-index/list-item-tags-column.tsx}
 */
import type { ReactNode } from "react";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { Button } from "../shared/button";

/** Simple-mode asset index filters a link can apply. */
export type AssetsFilter =
  | { category: string }
  | { tag: string }
  | { status: string }
  | { teamMember: string };

/**
 * Builds the `/assets` URL for one simple-mode filter.
 *
 * Needs no lookup of the viewer's index mode: the advanced index promotes a
 * bare value to `is:` and translates `tag` / `teamMember` to its own columns.
 * `buildAssetIndexFilterHref` (`modules/asset-index-settings/filter-href.ts`)
 * writes the mode-specific grammar instead; prefer this one for new links.
 *
 * @param filter - The filter key and its value, e.g. `{ tag: "<id>" }`
 * @returns A relative URL such as `/assets?tag=<id>`
 */
export function buildAssetsFilterHref(filter: AssetsFilter): string {
  return `/assets?${new URLSearchParams(filter)}`;
}

/**
 * Renders `children` as a link to the filtered asset index, or unchanged for
 * a viewer who may not read assets.
 */
export function AssetsFilterLink({
  filter,
  title,
  children,
}: {
  /** The filter the link applies */
  filter: AssetsFilter;
  /** Tooltip and accessible hint, e.g. "View assets tagged Laptop" */
  title: string;
  children: ReactNode;
}) {
  const roles = useOrganizationRoles();
  const canReadAssets = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: PermissionAction.read,
  });

  if (!canReadAssets) {
    return <>{children}</>;
  }

  return (
    <Button
      to={buildAssetsFilterHref(filter)}
      variant="inherit"
      className="hover:no-underline"
      title={title}
    >
      {children}
    </Button>
  );
}
