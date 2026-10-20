import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, Link, redirect, useLoaderData } from "react-router";
import { z } from "zod";
import { ImportContent } from "~/components/assets/import-content/index";
import Header from "~/components/layout/header";
import { MAX_BACKGROUND_IMPORT_FILE_BYTES } from "~/modules/asset-import/constants";
import { buildContentImportPreview } from "~/modules/asset-import/preview.server";
import {
  confirmAssetImport,
  getActiveAssetImport,
} from "~/modules/asset-import/service.server";
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

/**
 * Import upload and confirm.
 *
 * - `preview` (multipart `file`): parses the CSV, stores the validated rows as
 *   a DRAFT import and returns the preview. Nothing is created yet.
 * - `confirm` (`importId`): queues the draft for the background job and sends
 *   the user to its progress page.
 */
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

    // The body is read from a clone: `csvDataFromRequest` consumes the original.
    const formData = await request.clone().formData();
    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["preview", "confirm"]),
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
        additionalData: { intent },
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
        additionalData: { intent },
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const file = formData.get("file");
    const preview = await buildContentImportPreview({
      csvData,
      fileName: file instanceof File ? file.name : null,
      organizationId,
      userId,
      canUseBarcodes,
    });

    return payload({ intent: "preview" as const, preview });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    // The upload form renders the error itself, so no toast repeats it.
    return data(error(reason, false), { status: reason.status });
  }
};

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
