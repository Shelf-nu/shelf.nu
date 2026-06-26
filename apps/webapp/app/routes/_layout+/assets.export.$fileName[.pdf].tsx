/**
 * Asset-Index PDF Export route.
 *
 * Returns rendered HTML for browser print-to-PDF, composing existing
 * primitives (requirePermission, assertUserCanExportAssets, the
 * advanced-mode asset query) rather than introducing new server PDF
 * libraries.
 *
 * Routing precedent: `apps/webapp/app/routes/_layout+/assets.export.$fileName[.csv].tsx`
 * (the existing CSV export route; the `[.pdf]` bracketing mirrors its
 * `[.csv]`).
 *
 * Data path parity with CSV: the loader uses
 * `getAdvancedPaginatedAndFilterableAssets` + `getAdvancedFiltersFromRequest`
 * exactly like `exportAssetsFromIndexToCsv` does. This swap (commit after
 * 6dd022d07) replaced an earlier simple-mode path that only honored a
 * subset of filters and could not hydrate custom-field / barcode values —
 * Codex F1 + F2 on round-5 review. Sort handling, advanced operators,
 * custom-field filters, and per-cell custom-field / barcode rendering
 * all come for free with this pipeline.
 *
 * @see PRD-asset-index-pdf-export.md §6.0 + §6.1 (A0/A10/A12)
 * @see apps/webapp/app/utils/csv.server.ts:286 — canonical advanced-pipeline export pattern
 */
import type { Organization } from "@prisma/client";
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
import { getAdvancedPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { parseColumnName } from "~/modules/asset-index-settings/helpers";
import type { Column } from "~/modules/asset-index-settings/helpers";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getAdvancedFiltersFromRequest } from "~/utils/cookies.server";
import {
  formatCustomFieldForCsv,
  // why: same value-resolution helper the CSV exporter uses for custom
  // fields. Reused here for byte-for-byte parity in cell content.
} from "~/utils/csv.server";
import { getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanExportAssets } from "~/utils/subscription.server";
import { resolveTeamMemberName, resolveUserDisplayName } from "~/utils/user";

/**
 * Minimal HTML-escape for text interpolated into the static response
 * template (the `<title>` tag). The component body renders via
 * `renderToString` which auto-escapes, but the surrounding template is
 * raw string interpolation, so the workspace name needs manual escaping.
 *
 * C3 fix on commit 3d7ba0589: workspace names are user-controlled — a
 * name containing `</title><script>...</script>` would break out of the
 * title context and inject markup into this `text/html` response.
 *
 * @param input - Text to escape for safe interpolation into HTML content / attributes
 * @returns Escaped text
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolves one PDF cell value from an `AdvancedIndexAsset`, dispatching
 * on column name (fixed field / `cf_*` / `barcode_*`). Mirrors the
 * column-name switch in
 * `apps/webapp/app/utils/csv.server.ts:buildCsvExportDataFromAssets`
 * so CSV and PDF stay byte-for-byte identical per cell.
 *
 * Returns `Date` for date-typed fields (createdAt, updatedAt,
 * `upcomingReminder`, custom-field `DATE`) so the component cell
 * renderer can format via `formatAbsoluteDate` (CR-C fix on 6dd022d07:
 * avoids UTC truncation in `toISOString().split("T")`).
 *
 * @param asset - The advanced-mode hydrated asset row
 * @param colName - Column name from `AssetIndexSettings.columns`
 * @param cfType - CustomField type (when colName starts with `cf_`)
 * @param currency - Workspace currency (used by AMOUNT custom-field formatting)
 * @returns Cell value — string, number, Date, or null
 */
function resolveCellValue(
  asset: AdvancedIndexAsset,
  colName: string,
  cfType: Column["cfType"] | undefined,
  organization: Pick<Organization, "id" | "barcodesEnabled" | "currency">
): string | number | Date | null {
  // Custom-field columns (cf_<CustomField.name>)
  if (colName.startsWith("cf_")) {
    const cfName = colName.slice("cf_".length);
    const cf = asset.customFields?.find((c) => c.customField.name === cfName);
    if (!cf) return "";
    return formatCustomFieldForCsv(
      cf.value as unknown as ShelfAssetCustomFieldValueType["value"],
      cfType,
      organization
    );
  }

  // Barcode columns (barcode_<Barcode.type>)
  if (colName.startsWith("barcode_")) {
    const barcodeType = colName.slice("barcode_".length);
    return asset.barcodes?.find((b) => b.type === barcodeType)?.value ?? "";
  }

  switch (colName) {
    case "id":
      return asset.id;
    case "name":
    case "title":
      // The asset-index uses "name" as the column key; underlying field
      // is `asset.title`. Both keys resolve here for backward-compat
      // with older saved settings that may still use "title".
      return asset.title;
    case "sequentialId":
      return asset.sequentialId ?? "";
    case "qrId":
      return asset.qrId ?? "";
    case "status":
      return asset.status;
    case "description":
      return asset.description ?? "";
    case "valuation":
      return asset.valuation ?? "";
    case "availableToBook":
      return asset.availableToBook ? "Yes" : "No";
    case "createdAt":
      return asset.createdAt ?? null;
    case "updatedAt":
      return asset.updatedAt ?? null;
    case "category":
      return asset.category?.name ?? "";
    case "location":
      return asset.location?.name ?? "";
    case "kit":
      return asset.kit?.name ?? "";
    case "tags":
      return asset.tags?.map((t) => t.name).join(", ") ?? "";
    case "custody":
      return asset.custody?.custodian
        ? resolveTeamMemberName(asset.custody.custodian)
        : "";
    case "upcomingReminder":
      return asset.upcomingReminder?.alertDateTime
        ? new Date(asset.upcomingReminder.alertDateTime)
        : "";
    case "upcomingBookings":
      return asset.bookings?.map((b) => b.name).join(", ") ?? "";
    // image / actions / unknown — render as empty (image is handled by
    // the cell-render special case in the component, actions is filtered
    // out before this function runs).
    default:
      return "";
  }
}

/**
 * Server loader for the PDF export route. Per PRD §6.1:
 * - **A0** — tier-gated via `assertUserCanExportAssets` AND permission-gated
 *   via `requirePermission({entity:asset, action:export})`.
 * - **A10** — gate enforced HERE (loader), never UI-only.
 * - **A12** — IDOR protection: the asset query is org-scoped by the advanced
 *   pipeline's `generateWhereClause(organizationId, ...)`; no asset IDs from
 *   request input are trusted unscoped.
 *
 * @param args - LoaderFunctionArgs from React Router
 * @returns HTML Response for browser print
 */
export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  // A10: Permission gate enforced at loader (not UI-only). `role` and
  // `currentOrganization.barcodesEnabled` feed the canonical
  // `getAssetIndexSettings` service.
  const { organizationId, organizations, currentOrganization, role } =
    await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.export,
    });

  // A0: Tier gate - throws if canExportAssets is false
  await assertUserCanExportAssets({ organizationId, organizations });

  // A0.e + A0.f: read URL params for filter summary + thumbnail toggle.
  // Filter resolution itself is delegated to getAdvancedFiltersFromRequest
  // below (which knows how to fall back to cookies for advanced-mode users).
  const searchParams = getCurrentSearchParams(request);
  const filterSummary = summarizeFilters(searchParams);
  const includeImages = searchParams.get("includeImages") === "true";

  // Canonical settings load — creates defaults on first export and runs
  // `validateColumns`. D1 fix on commit 7d5ff8bee.
  const settings = await getAssetIndexSettings({
    userId,
    organizationId,
    canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
    role,
  });

  // Resolve filters from URL → cookies (in that order), per
  // `exportAssetsFromIndexToCsv` precedent. The redirect signal is
  // ignored: the export route returns HTML directly, it does not navigate.
  const { filters } = await getAdvancedFiltersFromRequest(
    request,
    organizationId,
    settings
  );

  // F1 fix (Codex P1 on commit 6dd022d07): use the canonical advanced-
  // mode asset pipeline (what CSV uses) instead of the simple-mode
  // `getAssetsWhereInput` + `db.asset.findMany`. The advanced pipeline:
  //   - honors ADVANCED-mode filter operators + custom-field filters
  //   - applies the user's sort (no per-route allowlist needed)
  //   - hydrates `customFields`, `barcodes`, `kit`, `tags`, `category`,
  //     `location`, `custody`, `upcomingReminder`, `bookings`
  //   - is org-scoped internally via `generateWhereClause` (A12 IDOR safe)
  // `takeAll: true` removes pagination — exports are not page-bounded.
  const { assets } = await getAdvancedPaginatedAndFilterableAssets({
    request,
    organizationId,
    filters: filters ?? "",
    settings,
    takeAll: true,
    canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
  });

  // C1 fix on commit 3d7ba0589: persisted column entries have no `label`
  // field — derive via parseColumnName (handles fixed fields via
  // columnsLabelsMap and `cf_*` by stripping the prefix).
  const labelFor = (name: string): string => parseColumnName(name) ?? name;

  // Build a name→cfType lookup for the row resolver. Only `cf_*` columns
  // carry a cfType; for everything else it's undefined.
  const cfTypeByName = new Map<string, Column["cfType"] | undefined>();
  for (const col of settings.columns as Column[]) {
    cfTypeByName.set(col.name, col.cfType);
  }

  // Drop only the UI-only `actions` column (no data to show); everything
  // else passes through. F2 fix on commit 6dd022d07 reverted the
  // over-eager `PDF_RENDERABLE_COLUMN_NAMES` allowlist that hid
  // user-enabled `cf_*` / `barcode_*` columns — now they render via the
  // advanced pipeline's hydrated data. Matches CSV's `actions` filter.
  let columns: PdfColumn[] = selectVisibleColumns(
    (settings.columns as unknown as RawColumnEntry[]).filter(
      (col) => col.name !== "actions"
    ),
    labelFor
  );

  // B2 fix on commit 3d7ba0589: when the user requests thumbnails,
  // prepend an "image" column at position -1 so the component's
  // column-loop renders it. Skip if settings already include "image"
  // (avoid duplicate).
  if (includeImages && !columns.some((c) => c.name === "image")) {
    columns = [{ name: "image", position: -1, label: "Image" }, ...columns];
  }

  // C2 + F2: row-value mapper dispatches per column name via the
  // shared resolver. Mirrors the CSV exporter's switch.
  const rows: PdfAssetRow[] = assets.map((asset) => {
    const values: Record<string, string | number | Date | null> = {};
    for (const col of columns) {
      values[col.name] = resolveCellValue(
        asset,
        col.name,
        cfTypeByName.get(col.name),
        currentOrganization
      );
    }
    return {
      id: asset.id,
      values,
      // Use thumbnailImage when available, fall back to mainImage
      thumbnailUrl: includeImages
        ? asset.thumbnailImage ?? asset.mainImage ?? null
        : null,
    };
  });

  // D2 fix on commit 7d5ff8bee: use the authenticated user's display
  // name for the footer, not a hardcoded "User".
  const exporter = await db.user.findUnique({
    where: { id: userId },
    select: { displayName: true, firstName: true, lastName: true },
  });
  const exporterDisplayName = resolveUserDisplayName(exporter) || "User";

  // Render the component to HTML string
  const html = renderToString(
    <AssetIndexPdf
      branding={{
        workspaceName: currentOrganization.name,
        workspaceLogoUrl: null,
      }}
      generatedAt={new Date()}
      generatedBy={{ displayName: exporterDisplayName }}
      filterSummary={filterSummary}
      columns={columns}
      rows={rows}
      includeImages={includeImages}
      totalRowCount={assets.length}
    />
  );

  const safeWorkspaceName = escapeHtml(currentOrganization.name);

  // Return as HTML response for browser print
  return new Response(
    `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Asset Export - ${safeWorkspaceName}</title>
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
