import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "react-router";
import { data, Link } from "react-router";
import { z } from "zod";
import { ImportUpdateContent } from "~/components/assets/import-update-content";
import Header from "~/components/layout/header";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { checkExhaustiveSwitch } from "~/utils/check-exhaustive-switch";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  buildUpdatePreview,
  applyBulkUpdatesFromImport,
} from "~/utils/import-update.server";
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
    const { organizationId, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.asset,
      action: PermissionAction.import,
    });

    await assertUserCanImportAssets({ organizationId, organizations });

    const { intent } = parseData(
      await request.clone().formData(),
      z.object({
        intent: z.enum(["preview-update", "apply-update"]),
      })
    );

    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty or has no data rows.",
        label: "Assets",
        shouldBeCaptured: false,
      });
    }

    switch (intent) {
      case "preview-update": {
        const preview = await buildUpdatePreview({
          csvData,
          organizationId,
        });
        return payload({ success: true, intent, preview });
      }

      case "apply-update": {
        const result = await applyBulkUpdatesFromImport({
          csvData,
          organizationId,
          userId,
          request,
        });
        return payload({ success: true, intent, result });
      }

      default:
        checkExhaustiveSwitch(intent);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
};

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
        title: "Update existing assets",
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
  breadcrumb: () => (
    <Link to="/assets/import-update">Update existing assets</Link>
  ),
};

export default function AssetsImportUpdate() {
  return (
    <div className="h-full">
      <Header />
      <div className="mx-auto h-auto w-full max-w-screen-lg px-4 py-10">
        <ImportUpdateContent />
      </div>
    </div>
  );
}
