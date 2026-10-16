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
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { applyMapping } from "~/modules/import-mapping/apply";
import {
  buildColumnSamples,
  isAlreadyShelfFormat,
} from "~/modules/import-mapping/heuristics";
import { proposeMapping } from "~/modules/import-mapping/model.server";
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

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations, canUseBarcodes } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.import,
      });

    await assertUserCanImportAssets({ organizationId, organizations });

    const { intent, mapping } = parseData(
      await request.clone().formData(),
      z.object({
        intent: z.enum(["analyze", "content"]),
        /** JSON of the reviewed ColumnMapping[]; absent on the legacy path. */
        mapping: z.string().max(200_000).optional(),
      })
    );

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty",
        additionalData: { intent },
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
          label: "Assets",
          status: 400,
          shouldBeCaptured: false,
        });
      }

      const existingCustomFields = await db.customField.findMany({
        where: { organizationId, deletedAt: null },
        select: { name: true, type: true },
      });
      const rowCount = csvData.length - 1;
      const proposal = await proposeMapping({
        organizationId,
        headers,
        samples,
        existingCustomFields,
        rowCount,
        canUseBarcodes: Boolean(canUseBarcodes),
      });

      return payload({
        proposal,
        rowCount,
        alreadyMatches: isAlreadyShelfFormat(proposal.columns),
      });
    }

    const mappedCsvData = mapping
      ? applyMapping(csvData, parseMapping(mapping))
      : csvData;

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
    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

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
