/**
 * Asset-Index PDF Export route.
 *
 * This route returns rendered HTML for browser print-to-PDF functionality.
 * It composes existing primitives (requirePermission, assertUserCanExportAssets,
 * getAssetsWhereInput) rather than introducing new server PDF libraries.
 *
 * Routing precedent: apps/webapp/app/routes/_layout+/assets.export.$fileName[.csv].tsx
 * (the existing CSV export route; the [.pdf] bracketing mirrors its [.csv]).
 *
 * Contract source: PRD-asset-index-pdf-export.md §6.0 + §6.1 (A0/A10/A12).
 *
 * @see PRD-asset-index-pdf-export.md
 * @see apps/webapp/app/components/booking/booking-overview-pdf.tsx — canonical pattern
 */
import { renderToString } from "react-dom/server";
import type { LoaderFunctionArgs } from "react-router";
import {
  AssetIndexPdf,
  selectVisibleColumns,
  summarizeFilters,
  type PdfAssetRow,
  type PdfColumn,
  type RawColumnEntry,
} from "~/components/assets/assets-index/export-assets-pdf";
import { db } from "~/database/db.server";
import { getAssetsWhereInput } from "~/modules/asset/utils.server";
import { getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanExportAssets } from "~/utils/subscription.server";

/**
 * Server loader for the PDF export route. Per PRD §6.1:
 * - A0: tier-gated via `assertUserCanExportAssets` (uses getOrganizationTierLimit internally)
 *   AND permission-gated via `requirePermission({entity:asset, action:export})`.
 * - A10: gate is enforced HERE (loader), never UI-only.
 * - A12: asset query uses `getAssetsWhereInput({organizationId, currentSearchParams})`
 *   exclusively — no asset IDs from request input are trusted unscoped.
 *
 * @param args - The loader function arguments
 * @returns HTML Response for browser print
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  // A10: Permission gate enforced at loader (not UI-only)
  const { organizationId, organizations, currentOrganization } =
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.export,
    });

  // A0: Tier gate - throws if canExportAssets is false
  await assertUserCanExportAssets({ organizationId, organizations });

  // A0.c + A12: Build the where clause using ONLY organizationId and currentSearchParams
  // NEVER use asset IDs from request input (IDOR protection)
  const searchParams = getCurrentSearchParams(request);
  const currentSearchParams = searchParams.toString();

  // A0.e: Build filter summary from search params
  const filterSummary = summarizeFilters(searchParams);

  // A0.f: Parse includeImages param from URL
  const includeImages = searchParams.get("includeImages") === "true";

  // A12: getAssetsWhereInput scopes query to organizationId
  const where = getAssetsWhereInput({
    organizationId,
    currentSearchParams: currentSearchParams || null,
  });

  // Fetch assets scoped to the organization (A12 behavioral IDOR protection)
  // Include thumbnailImage when includeImages is true
  const assets = await db.asset.findMany({
    where,
    select: {
      id: true,
      title: true,
      status: true,
      category: { select: { name: true } },
      location: { select: { name: true } },
      mainImage: includeImages,
      thumbnailImage: includeImages,
    },
  });

  // A0.d: Fetch user's AssetIndexSettings to get their column configuration
  const assetIndexSettings = await db.assetIndexSettings.findFirst({
    where: { userId, organizationId },
    select: { columns: true },
  });

  // Build columns from user settings or use defaults
  let columns: PdfColumn[];
  if (
    assetIndexSettings?.columns &&
    Array.isArray(assetIndexSettings.columns)
  ) {
    // User has custom column settings - use selectVisibleColumns to filter/sort
    columns = selectVisibleColumns(
      assetIndexSettings.columns as RawColumnEntry[]
    );
  } else {
    // No user settings - use default columns
    columns = [
      { name: "id", position: 0, label: "ID" },
      { name: "title", position: 1, label: "Title" },
      { name: "status", position: 2, label: "Status" },
      { name: "category", position: 3, label: "Category" },
      { name: "location", position: 4, label: "Location" },
    ];
  }

  // B2 fix (per CR re-review on 46d0da59f): the component's <img> render
  // now lives EXCLUSIVELY in the column-loop branch (col.name === "image").
  // When the user requests thumbnails, prepend an "image" column at
  // position -1 so it renders first in the PDF; otherwise the column-
  // loop branch never fires and no thumbnails appear. Skip if the user's
  // settings already include an "image" column (avoid duplicate).
  if (includeImages && !columns.some((c) => c.name === "image")) {
    columns = [{ name: "image", position: -1, label: "Image" }, ...columns];
  }

  // Transform assets to PdfAssetRow format
  const rows: PdfAssetRow[] = assets.map((asset) => ({
    id: asset.id,
    values: {
      id: asset.id,
      title: asset.title,
      status: asset.status,
      category: asset.category?.name ?? "",
      location: asset.location?.name ?? "",
    },
    // Use thumbnailImage when available, fall back to mainImage
    thumbnailUrl: includeImages
      ? (asset as { thumbnailImage?: string | null }).thumbnailImage ??
        (asset as { mainImage?: string | null }).mainImage ??
        null
      : null,
  }));

  // Render the component to HTML string
  const html = renderToString(
    <AssetIndexPdf
      branding={{
        workspaceName: currentOrganization.name,
        workspaceLogoUrl: null,
      }}
      generatedAt={new Date()}
      generatedBy={{ displayName: "User" }}
      filterSummary={filterSummary}
      columns={columns}
      rows={rows}
      includeImages={includeImages}
      totalRowCount={assets.length}
    />
  );

  // Return as HTML response for browser print
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Asset Export - ${currentOrganization.name}</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; margin: 0; padding: 20px; }
    @media print { @page { margin: 10mm; size: A4 landscape; } }
  </style>
</head>
<body>
  ${html}
</body>
</html>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}

/**
 * Route component - not used since loader returns HTML directly.
 * Kept for route module completeness.
 */
export default function AssetIndexPdfExportRoute() {
  return null;
}
