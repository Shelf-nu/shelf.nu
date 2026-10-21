import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, Link, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { ImportContent } from "~/components/assets/import-content/index";
import Header from "~/components/layout/header";
import { db } from "~/database/db.server";
import { captureServerEvent } from "~/integrations/posthog/client.server";
import {
  MAX_BACKGROUND_IMPORT_FILE_BYTES,
  MAX_BACKGROUND_IMPORT_ROWS,
} from "~/modules/asset-import/constants";
import { buildContentImportPreview } from "~/modules/asset-import/preview.server";
import {
  confirmAssetImport,
  getActiveAssetImport,
} from "~/modules/asset-import/service.server";
import { applyMapping } from "~/modules/import-mapping/apply";
import { classifyImportFailure } from "~/modules/import-mapping/failure";
import { buildColumnSamples } from "~/modules/import-mapping/heuristics";
import { proposeMapping } from "~/modules/import-mapping/propose";
import type { ColumnMapping } from "~/modules/import-mapping/types";
import {
  MAX_HEADER_LENGTH,
  MAX_MAPPED_COLUMNS,
  MAX_MAPPING_FIELD_LENGTH,
  columnMappingListSchema,
} from "~/modules/import-mapping/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { assertUserCanImportAssets } from "~/utils/subscription.server";
import { optionalNumberFromString } from "~/utils/zod-numeric";

/**
 * Import upload, column mapping and confirm.
 *
 * - `analyze` (multipart `file`): parses the CSV and proposes where each column
 *   goes (see `modules/import-mapping`). Nothing is stored.
 * - `preview` (multipart `file`, optional `mapping`): applies the reviewed
 *   mapping when one is posted (renames and drops columns, never changes a
 *   value), then stores the validated rows as a DRAFT import and returns the
 *   preview. Nothing is created yet.
 * - `confirm` (`importId`): queues the draft for the background job and sends
 *   the user to its progress page.
 */
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

    // The body is read from a clone: `csvDataFromRequest` consumes the original.
    const formData = await request.clone().formData();
    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["analyze", "preview", "confirm"]),
      })
    );

    if (intent === "confirm") {
      const { importId } = parseData(
        formData,
        z.object({ importId: z.string().min(1) })
      );
      await confirmAssetImport({
        importId,
        organizationId,
        userId,
        canUseBarcodes,
      });
      return redirect(`/assets/import/${importId}`);
    }

    const csvData = await csvDataFromRequest({
      request,
      maxFileSize: MAX_BACKGROUND_IMPORT_FILE_BYTES,
    });
    if (csvData.length === 0) {
      throw new ShelfError({
        cause: null,
        message: "This file is empty.",
        additionalData: { intent, failureReason: "empty_file" },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }
    if (csvData.length === 1) {
      throw new ShelfError({
        cause: null,
        title: "No assets in file",
        message:
          "This file has headers but no assets. Add at least one row below the headers.",
        additionalData: { intent, failureReason: "empty_file" },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    if (intent === "analyze") {
      return payload({
        intent: "analyze" as const,
        ...(await analyzeColumns({
          csvData,
          organizationId,
          userId,
          canUseBarcodes: Boolean(canUseBarcodes),
        })),
      });
    }

    const { mapping, mappingChanged, mappingNewCustomFields } = parseData(
      formData,
      z.object({
        /** JSON of the reviewed ColumnMapping[]; absent for a file posted as-is. */
        mapping: z.string().max(MAX_MAPPING_FIELD_LENGTH).optional(),
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

    const columns = mapping ? parseMapping(mapping) : null;
    const mappedCsvData = columns ? applyMapping(csvData, columns) : csvData;

    const file = formData.get("file");
    const preview = await buildContentImportPreview({
      csvData: mappedCsvData,
      fileName: file instanceof File ? file.name : null,
      organizationId,
      userId,
      canUseBarcodes,
    });

    // Sent once the draft exists, so a retry after row errors counts once.
    if (columns) {
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

    return payload({ intent: "preview" as const, preview });
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
    // The upload form renders the error itself, so no toast repeats it.
    return data(error(reason, false), { status: reason.status });
  }
};

/**
 * Proposes a column mapping for an uploaded file and the facts the review
 * table needs. Refuses up front what the importer would refuse after the
 * review: too many columns, too many rows, or an over-long heading.
 *
 * @param args.csvData - Parsed CSV, header row first, at least one data row
 * @param args.organizationId - The caller's workspace
 * @param args.userId - The caller, for analytics
 * @param args.canUseBarcodes - Whether barcode fields may be proposed
 * @returns The proposal, row count and existing custom fields
 * @throws {ShelfError} 400 for a file the importer cannot take
 */
async function analyzeColumns({
  csvData,
  organizationId,
  userId,
  canUseBarcodes,
}: {
  csvData: string[][];
  organizationId: string;
  userId: string;
  canUseBarcodes: boolean;
}) {
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

  const rowCount = csvData.length - 1;
  if (rowCount > MAX_BACKGROUND_IMPORT_ROWS) {
    throw new ShelfError({
      cause: null,
      title: "File too large",
      message: `This file has ${rowCount} rows, but the maximum is ${MAX_BACKGROUND_IMPORT_ROWS}. Please split it into smaller files and import them one at a time.`,
      additionalData: { failureReason: "too_many_rows" },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const longHeading = headers.findIndex(
    (header) => header.length > MAX_HEADER_LENGTH
  );
  if (longHeading !== -1) {
    throw new ShelfError({
      cause: null,
      title: "Column heading too long",
      message: `Column ${longHeading + 1} has a heading of ${
        headers[longHeading].length
      } characters, but the maximum is ${MAX_HEADER_LENGTH}. Shorten it and try again.`,
      additionalData: { failureReason: "heading_too_long" },
      label: "Assets",
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const existingCustomFields = await db.customField.findMany({
    where: { organizationId, deletedAt: null },
    select: { name: true, type: true },
  });

  const proposal = await proposeMapping({
    headers,
    samples,
    existingCustomFields,
    rowCount,
    canUseBarcodes,
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

  return {
    proposal,
    rowCount,
    existingCustomFields,
  };
}

/**
 * Reads the reviewed mapping posted with the `preview` intent.
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

/**
 * Import upload page.
 *
 * Returns the header and the workspace's QUEUED or RUNNING import, if any, so
 * the page can hold the upload form until that import finishes.
 */
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

    // Only one import runs per workspace at a time. The lookup also returns
    // the viewer's recently finished import, which must not block the form.
    const active = await getActiveAssetImport({ userId, organizationId });
    const runningImport =
      active && (active.status === "QUEUED" || active.status === "RUNNING")
        ? active
        : null;

    return payload({
      header: {
        title: "Import assets",
      },
      runningImport,
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
  breadcrumb: () => <Link to="/assets/import">Import</Link>,
};

export default function AssetsImport() {
  const { runningImport } = useLoaderData<typeof loader>();

  return (
    <div className="h-full">
      <Header />
      <div className="mx-auto h-auto w-full px-4 py-10">
        <ImportContent runningImport={runningImport} />
      </div>
    </div>
  );
}
