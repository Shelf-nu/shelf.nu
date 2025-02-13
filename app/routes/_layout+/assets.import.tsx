import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { z } from "zod";
import { ImportContent } from "~/components/assets/import-content";
import Header from "~/components/layout/header";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { ASSET_CSV_HEADERS } from "~/modules/asset/utils.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
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
        intent: z.enum(["content"]),
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

    const contentData = extractCSVDataFromContentImport(
      csvData,
      ASSET_CSV_HEADERS
    );

    await createAssetsFromContentImport({
      data: contentData,
      userId,
      organizationId,
    });
    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
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

    return json(
      data({
        header: {
          title: "Import assets",
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
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
      <div className="flex h-auto w-full flex-col items-center py-10 max-w-screen-sm mx-auto">
        <ImportContent />
      </div>
    </div>
  );
}
