/**
 * Asset-Index PDF Export route.
 *
 * TDD RED STATE (commit 1): the loader is a stub that throws. The /goal
 * loop fills the implementation in once the §4.2 adequacy gate has
 * approved the test suite and the §14 open questions are answered.
 *
 * Routing precedent: apps/webapp/app/routes/_layout+/assets.export.$fileName[.csv].tsx
 * (the existing CSV export route; the [.pdf] bracketing mirrors its [.csv]).
 *
 * Contract source: PRD-asset-index-pdf-export.md §6.0 + §6.1 (A0/A10/A12).
 *
 * @see PRD-asset-index-pdf-export.md
 */
import type { LoaderFunctionArgs } from "react-router";

/**
 * Server loader for the PDF export route. Per PRD §6.1:
 * - A0: tier-gated via `getOrganizationTierLimit({organizationId, organizations}).canExportAssets`
 *   AND permission-gated via `requirePermission({entity:asset, action:export})`.
 * - A10: gate is enforced HERE (loader), never UI-only.
 * - A12: asset query uses `getAssetsWhereInput({organizationId, currentSearchParams})`
 *   exclusively — no asset IDs from request input are trusted unscoped.
 * - Reuses the existing select-all/filter pattern (ALL_SELECTED_KEY,
 *   isSelectingAllItems, takeAll:true) per CLAUDE.md "Bulk Operations
 *   & Select All Pattern."
 *
 * @throws TDD-red until implementation lands.
 */
export async function loader(_args: LoaderFunctionArgs) {
  throw new Error(
    "loader: not implemented (TDD red — see PRD §6.1 A0/A10/A12)"
  );
}

/** Route component is a stub; the loader returns rendered HTML directly. */
export default function AssetIndexPdfExportRoute() {
  throw new Error("route component: not implemented (TDD red)");
}
