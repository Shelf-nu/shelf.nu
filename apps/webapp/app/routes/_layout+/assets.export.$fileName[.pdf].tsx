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
import { parseColumnName } from "~/modules/asset-index-settings/helpers";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getCurrentSearchParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanExportAssets } from "~/utils/subscription.server";
import { resolveTeamMemberName, resolveUserDisplayName } from "~/utils/user";

/**
 * Minimal HTML-escape for text interpolated into the response template.
 * Used for the `<title>` interpolation of the workspace name (C3 fix per
 * Codex P1 on commit 3d7ba0589): workspace names are user-controlled, so
 * a name containing `</title><script>...</script>` would break out of
 * the title context and inject markup into this `text/html` response.
 *
 * Scope-limited helper — the rest of the document body is rendered via
 * React's `renderToString` which auto-escapes. Only the static template
 * around it needs manual escaping.
 *
 * @param input - The text to escape for safe HTML interpolation
 * @returns HTML-escaped text safe to interpolate into element content / attributes
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
 * E1 fix (per Codex P2 on commit 7609b8d97): allowlist of asset-index
 * column names that may be used as a sort key in the URL `orderBy`
 * param. Strict allowlist — any other value falls back to the default
 * sort, so a malicious or stale URL param can't cause a Prisma error
 * (e.g. ordering by a non-existent field) or order by a non-scalar
 * relation we haven't planned for.
 *
 * Asset-index "name" is mapped to the Prisma scalar `title`.
 *
 * Sort by relations (category/location/kit/custody) and arrays
 * (tags/upcomingX/barcodes/cf_*) are NOT supported by this allowlist —
 * those need either nested orderBy syntax or a switch to the advanced-
 * mode pipeline. Tracked as a follow-up.
 */
const PDF_SORTABLE_ASSET_FIELDS: Readonly<Record<string, string>> = {
  name: "title",
  title: "title",
  sequentialId: "sequentialId",
  status: "status",
  valuation: "valuation",
  availableToBook: "availableToBook",
  createdAt: "createdAt",
  updatedAt: "updatedAt",
};

/**
 * E2 fix (per Codex P2 on commit 7609b8d97): allowlist of column names
 * the PDF row mapper actually populates. Settings stored upstream
 * (created by the canonical service) include UI-only columns like
 * `actions` and not-yet-populated columns like `upcomingReminder`,
 * `upcomingBookings`, `barcode_*`, and `cf_*`. Including them as PDF
 * columns produces a row of blank cells for every asset — misleading
 * to users on first export. We filter to the renderable set so the
 * deferred columns are simply omitted from the PDF rather than blanked.
 *
 * Keep this in lockstep with the keys populated by the row-value
 * mapper below. The `image` column is added dynamically when
 * `?includeImages=true` and lives outside settings.columns.
 */
const PDF_RENDERABLE_COLUMN_NAMES: ReadonlySet<string> = new Set([
  "id",
  "name",
  "title",
  "sequentialId",
  "qrId",
  "status",
  "description",
  "valuation",
  "availableToBook",
  "createdAt",
  "updatedAt",
  "category",
  "location",
  "kit",
  "tags",
  "custody",
]);

/**
 * Build a Prisma `orderBy` clause from the request URL search params,
 * defaulting to `createdAt desc` (asset-index default).
 *
 * @param searchParams - URLSearchParams from the request
 * @returns A Prisma-compatible orderBy object
 */
function buildOrderBy(searchParams: URLSearchParams): {
  [key: string]: "asc" | "desc";
} {
  const rawField = searchParams.get("orderBy");
  const rawDir = searchParams.get("orderDirection");
  const prismaField =
    rawField &&
    Object.prototype.hasOwnProperty.call(PDF_SORTABLE_ASSET_FIELDS, rawField)
      ? PDF_SORTABLE_ASSET_FIELDS[rawField]
      : null;
  if (!prismaField) return { createdAt: "desc" };
  return { [prismaField]: rawDir === "asc" ? "asc" : "desc" };
}

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

  // A10: Permission gate enforced at loader (not UI-only).
  // `role` and `currentOrganization.barcodesEnabled` are required by the
  // canonical `getAssetIndexSettings` service (D1 fix below).
  const { organizationId, organizations, currentOrganization, role } =
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

  // E1 fix (per Codex P2 on commit 7609b8d97): honor the user's
  // current view sort. Without this the PDF rows used DB-default
  // ordering and could disagree with what the user sees on screen.
  // The allowlist (`PDF_SORTABLE_ASSET_FIELDS`) blocks unsupported
  // or unknown field names.
  const orderBy = buildOrderBy(searchParams);

  // Fetch assets scoped to the organization (A12 behavioral IDOR protection).
  //
  // C2 fix (per Codex P1 on commit 3d7ba0589): the previous select only
  // included id/title/status/category/location, so any user whose saved
  // `AssetIndexSettings.columns` referenced other fixed fields
  // (sequentialId, description, valuation, availableToBook, createdAt,
  // updatedAt, qrId, tags, kit, custody) got empty cells. The select
  // below covers the full fixed-field surface of the asset index.
  //
  // Deferred (see PRD §15.x follow-up): custom fields (`cf_*`), barcodes
  // (`barcode_*`), `upcomingReminder`, `upcomingBookings`. These require
  // either a richer Prisma include depth (custom-field values, barcode
  // arrays, reminder join with date filter) or a switch to the advanced-
  // mode pipeline (`getAdvancedPaginatedAndFilterableAssets`). Tracked
  // for a dedicated follow-up rather than expanded inline here to keep
  // the PR scoped to the bugs Codex flagged.
  const assets = await db.asset.findMany({
    where,
    orderBy,
    select: {
      id: true,
      title: true,
      sequentialId: true,
      description: true,
      valuation: true,
      availableToBook: true,
      createdAt: true,
      updatedAt: true,
      status: true,
      category: { select: { name: true } },
      location: { select: { name: true } },
      kit: { select: { name: true } },
      tags: { select: { name: true } },
      qrCodes: { select: { id: true }, take: 1 },
      custody: {
        select: {
          custodian: {
            select: {
              name: true,
              user: {
                select: { displayName: true, firstName: true, lastName: true },
              },
            },
          },
        },
      },
      mainImage: includeImages,
      thumbnailImage: includeImages,
    },
  });

  // A0.d / D1 fix (per Codex P2 on commit 7d5ff8bee): load the user's
  // AssetIndexSettings through the canonical service rather than a raw
  // `db.assetIndexSettings.findFirst`. The service creates default
  // settings on first export and runs `validateColumns` — both of which
  // a raw findFirst skips, leaving first-export users with an ad-hoc
  // 5-column layout instead of the canonical defaults from
  // `~/modules/asset-index-settings/helpers.defaultFields`.
  const settings = await getAssetIndexSettings({
    userId,
    organizationId,
    canUseBarcodes: currentOrganization.barcodesEnabled ?? false,
    role,
  });

  // C1 fix (per Codex P1 on commit 3d7ba0589): persisted column entries
  // in `AssetIndexSettings.columns` have no `label` field — they are
  // `{name, visible, position}` per `~/modules/asset-index-settings/helpers`.
  // We pass `parseColumnName` as the label resolver: it handles fixed
  // fields via `columnsLabelsMap` and custom fields by stripping `cf_`.
  const labelFor = (name: string): string => parseColumnName(name) ?? name;

  // E2 fix (per Codex P2 on commit 7609b8d97): the canonical settings
  // service returns `defaultFields` which include UI-only columns
  // (`actions`) and not-yet-populated columns (`upcomingReminder`,
  // `upcomingBookings`, `barcode_*`, `cf_*`). The PDF row mapper only
  // populates the fixed-field scalars / simple-relation columns from
  // `PDF_RENDERABLE_COLUMN_NAMES`. Without filtering, the PDF would
  // ship blank trailing cells for every non-renderable column — what
  // Codex flagged as misleading on first export. Mirrors the CSV
  // exporter, which excludes `actions` explicitly.
  const rawColumns = (settings.columns as unknown as RawColumnEntry[]).filter(
    (col) => PDF_RENDERABLE_COLUMN_NAMES.has(col.name)
  );
  let columns: PdfColumn[] = selectVisibleColumns(rawColumns, labelFor);

  // B2 fix (per CR re-review on 46d0da59f): the component's <img> render
  // now lives EXCLUSIVELY in the column-loop branch (col.name === "image").
  // When the user requests thumbnails, prepend an "image" column at
  // position -1 so it renders first in the PDF; otherwise the column-
  // loop branch never fires and no thumbnails appear. Skip if the user's
  // settings already include an "image" column (avoid duplicate).
  if (includeImages && !columns.some((c) => c.name === "image")) {
    columns = [{ name: "image", position: -1, label: "Image" }, ...columns];
  }

  // C2 fix (per Codex P1 on commit 3d7ba0589): the row-value mapper
  // covers all fixed-field column names produced by the asset-index, so
  // selecting `valuation`, `description`, `sequentialId`, etc. renders
  // populated cells (not blank). Mirrors the `case` mapping in the CSV
  // exporter at `~/utils/csv.server.buildCsvExportDataFromAssets`.
  //
  // Note: `name` is the asset-index convention; underlying field is
  // `asset.title`. Both `name` and `title` map to `asset.title` for
  // backward-compatibility with any saved settings that used the older
  // key (the asset-index has migrated to `name`).
  //
  // `valuation` is exported as the raw number; consumers (browser print)
  // see it as-is. Currency formatting parity with CSV is a follow-up
  // tied to per-row locale resolution.
  //
  // Custody / custom-field / barcode / upcomingX values: see deferred
  // notes on the `db.asset.findMany` select above.
  const rows: PdfAssetRow[] = assets.map((asset) => {
    const custodyDisplay = asset.custody?.custodian
      ? resolveTeamMemberName(asset.custody.custodian)
      : "";
    const values: Record<string, string | number | null> = {
      id: asset.id,
      name: asset.title,
      title: asset.title, // backward-compat with older saved settings
      sequentialId: asset.sequentialId ?? "",
      qrId: asset.qrCodes?.[0]?.id ?? "",
      status: asset.status,
      description: asset.description ?? "",
      valuation: asset.valuation ?? "",
      availableToBook: asset.availableToBook ? "Yes" : "No",
      createdAt: asset.createdAt
        ? new Date(asset.createdAt).toISOString().split("T")[0]
        : "",
      updatedAt: asset.updatedAt
        ? new Date(asset.updatedAt).toISOString().split("T")[0]
        : "",
      category: asset.category?.name ?? "",
      location: asset.location?.name ?? "",
      kit: asset.kit?.name ?? "",
      tags: asset.tags?.map((t) => t.name).join(", ") ?? "",
      custody: custodyDisplay,
    };
    return {
      id: asset.id,
      values,
      // Use thumbnailImage when available, fall back to mainImage
      thumbnailUrl: includeImages
        ? (asset as { thumbnailImage?: string | null }).thumbnailImage ??
          (asset as { mainImage?: string | null }).mainImage ??
          null
        : null,
    };
  });

  // D2 fix (per Codex P2 on commit 7d5ff8bee): the previous code
  // hardcoded `generatedBy: "User"`, so every export footer lost the
  // actual identity of the exporter — misleading in multi-user
  // organizations and breaks audit value. Fetch the authenticated
  // user's name fields and pass through `resolveUserDisplayName`
  // (which handles displayName / firstName+lastName / fallback).
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

  // C3 fix (per Codex P1 on commit 3d7ba0589): workspace names are
  // user-controlled, so a name containing `</title><script>...</script>`
  // would break out of the title context and inject markup into this
  // `text/html` response. The component body uses React's renderToString
  // (auto-escapes), but the static template around it is raw string
  // interpolation and must be escaped manually.
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
