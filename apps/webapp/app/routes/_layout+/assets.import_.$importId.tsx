/**
 * Asset import progress page.
 *
 * Shows one import's status. The loader reads the status plus the stored
 * warnings; the `resume` action puts a FAILED import back on the queue.
 *
 * @see {@link file://./../api+/asset-imports.$importId.ts} the polled status endpoint
 * @see {@link file://./../../modules/asset-import/service.server.ts}
 */
import { useMemo } from "react";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, Link, useLoaderData } from "react-router";
import { z } from "zod";
import { ImportProgress } from "~/components/assets/import-content/import-progress";
import Header from "~/components/layout/header";
import {
  getAssetImportDetails,
  resumeAssetImport,
} from "~/modules/asset-import/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const paramsSchema = z.object({ importId: z.string().min(1) });

/**
 * Loads the import for this page.
 *
 * @throws 404 when the import is not in this workspace or is still a draft,
 * 403 without `asset: import`
 */
export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });
    const { importId } = getParams(params, paramsSchema);

    const importDetails = await getAssetImportDetails({
      importId,
      organizationId,
      userId,
    });

    return payload({
      header: { title: "Import progress" },
      import: importDetails,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
};

/**
 * Handles the `resume` intent: queues a FAILED import again.
 *
 * @throws 404 when the import is not a FAILED import of this workspace, 409
 * when another import is active, 403 without `asset: import`
 */
export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const { userId } = context.getSession();

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });
    const { importId } = getParams(params, paramsSchema);

    parseData(
      await request.formData(),
      z.object({ intent: z.enum(["resume"]) })
    );

    await resumeAssetImport({ importId, organizationId });

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: (match: { data?: { import?: { id?: string } } }) => (
    <Link to={`/assets/import/${match.data?.import?.id ?? ""}`}>
      Import progress
    </Link>
  ),
};

/** Progress page: follows the import until it completes or fails. */
export default function AssetImportProgress() {
  const { import: assetImport } = useLoaderData<typeof loader>();
  // Stable between renders: the hook tells a newer loader payload from an
  // older poll by identity.
  const { initial, warnings } = useMemo(() => {
    const { warnings, ...status } = assetImport;
    return { initial: status, warnings };
  }, [assetImport]);

  return (
    <div className="h-full">
      <Header />
      <div className="mx-auto h-auto w-full px-4 py-10">
        <ImportProgress
          importId={assetImport.id}
          initial={initial}
          warnings={warnings}
        />
      </div>
    </div>
  );
}
