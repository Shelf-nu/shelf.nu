import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, Link } from "react-router";
import { z } from "zod";
import { ImportContent } from "~/components/assets/import-content";
import Header from "~/components/layout/header";
import { db } from "~/database/db.server";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { applyMapping } from "~/modules/import-mapping/apply";
import { classifyImportFailure } from "~/modules/import-mapping/failure";
import {
  buildColumnSamples,
  isAlreadyShelfFormat,
} from "~/modules/import-mapping/heuristics";
import { proposeMapping } from "~/modules/import-mapping/propose";
import { buildColumnStats } from "~/modules/import-mapping/summary";
import type { ColumnMapping } from "~/modules/import-mapping/types";
import {
  MAX_MAPPED_COLUMNS,
  columnMappingListSchema,
} from "~/modules/import-mapping/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanImportAssets } from "~/utils/subscription.server";
import { optionalNumberFromString } from "~/utils/zod-numeric";

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  /** Set once the access gates pass; only later failures are reported. */
  let gatedOrganizationId: string | null = null;

  try {
    const { organizationId, organizations, canUseBarcodes } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.import,
      });

    await assertUserCanImportAssets({ organizationId, organizations });
    gatedOrganizationId = organizationId;

    const { intent, mapping, mappingChanged, mappingNewCustomFields } =
      parseData(
        await request.clone().formData(),
        z.object({
          intent: z.enum(["analyze", "content"]),
          /** JSON of the reviewed ColumnMapping[]; absent on the legacy path. */
          mapping: z.string().max(200_000).optional(),
          /** Columns the user changed in the review (analytics only). */
          mappingChanged: optionalNumberFromString({ blank: undefined }).pipe(
            z.number().int().min(0).max(1000).optional()
          ),
          /** Custom fields the reviewed mapping creates (analytics only). */
          mappingNewCustomFields: optionalNumberFromString({
            blank: undefined,
          }).pipe(z.number().int().min(0).max(1000).optional()),
        })
      );

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty",
        additionalData: { intent, failureReason: "empty_file" },
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    if (intent === "analyze") {
      const { headers, samples } = buildColumnSamples(csvData);
      if (headers.length > MAX_MAPPED_COLUMNS) {
        throw new ShelfError({
          cause: null,
          title: "Too many columns",
          message: `This file has ${headers.length} columns, but the maximum is ${MAX_MAPPED_COLUMNS}. Remove the columns you do not need and try again.`,
          additionalData: { failureReason: "too_many_columns" },
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        });
      }

      const [existingCustomFields, categories, locations] = await Promise.all([
        loadExistingCustomFields(organizationId),
        db.category.findMany({
          where: { organizationId },
          select: { name: true },
        }),
        db.location.findMany({
          where: { organizationId },
          select: { name: true },
        }),
      ]);
      const rowCount = csvData.length - 1;
      const proposal = await proposeMapping({
        headers,
        samples,
        existingCustomFields,
        rowCount,
        canUseBarcodes: Boolean(canUseBarcodes),
      });

      captureServerEvent({
        distinctId: userId,
        event: "import_mapping_proposed",
        properties: {
          organizationId,
          columns: proposal.columns.length,
          lowConfidence: proposal.columns.filter(
            (column) => column.confidence === "low"
          ).length,
        },
      });

      return payload({
        proposal,
        rowCount,
        alreadyMatches: isAlreadyShelfFormat(proposal.columns),
        columnStats: buildColumnStats(csvData, {
          categories: categories.map(({ name }) => name),
          locations: locations.map(({ name }) => name),
        }),
        existingCustomFields,
      });
    }

    let mappedCsvData: string[][] = csvData;
    if (mapping) {
      const columns = parseMapping(mapping);
      mappedCsvData = applyMapping(csvData, columns);

      captureServerEvent({
        distinctId: userId,
        event: "import_mapping_confirmed",
        properties: {
          organizationId,
          columns: columns.length,
          changedByUser: mappingChanged ?? 0,
          newCustomFields: mappingNewCustomFields ?? 0,
        },
      });
    }

    const contentData = extractCSVDataFromContentImport(
      mappedCsvData,
      ASSET_CSV_HEADERS
    );

    await createAssetsFromContentImport({
      data: contentData,
      userId,
      organizationId,
      canUseBarcodes,
    });

    captureServerEvent({
      distinctId: userId,
      event: "import_completed",
      properties: {
        organizationId,
        rows: contentData.length,
      },
    });
    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    if (gatedOrganizationId) {
      captureServerEvent({
        distinctId: userId,
        event: "import_failed",
        properties: {
          organizationId: gatedOrganizationId,
          reason: classifyImportFailure(reason),
        },
      });
    }
    return data(error(reason), { status: reason.status });
  }
};

/**
 * Loads the workspace's custom field names and types, matching the
 * importer's own lookup (non-deleted, active or not).
 *
 * @param organizationId - The caller's workspace
 * @returns Name and type of every non-deleted custom field
 */
function loadExistingCustomFields(organizationId: string) {
  return db.customField.findMany({
    where: { organizationId, deletedAt: null },
    select: { name: true, type: true },
  });
}

/**
 * Reads the reviewed mapping posted with the `content` intent.
 *
 * @param raw - The `mapping` form field, JSON of `ColumnMapping[]`
 * @returns The validated mapping
 * @throws {ShelfError} 400 when the field is not a valid mapping
 */
function parseMapping(raw: string): ColumnMapping[] {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    json = undefined;
  }
  const result = columnMappingListSchema.safeParse(json);
  if (!result.success) {
    throw new ShelfError({
      cause: result.error,
      title: "Invalid column mapping",
      message:
        "The column mapping could not be read. Pick the file again to get a fresh mapping.",
      additionalData: { failureReason: "invalid_mapping" },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }
  return result.data;
}

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });

    await assertUserCanImportAssets({ organizationId, organizations });

    return payload({
      header: {
        title: "Import assets",
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <Link to="/import">Import</Link>,
};

export default function AssetsImport() {
  return (
    <div className="h-full">
      <Header />
      <div className="mx-auto h-auto w-full px-4 py-10">
        <ImportContent />
      </div>
    </div>
  );
}
