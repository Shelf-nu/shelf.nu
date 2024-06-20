import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { z } from "zod";
import {
  ImportBackup,
  ImportContent,
} from "~/components/assets/import-content";
import Header from "~/components/layout/header";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { createAssetsFromContentImport } from "~/modules/asset/service.server";
import { assertUserCanImportAssets } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { csvDataFromRequest } from "~/utils/csv.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { extractCSVDataFromContentImport } from "~/utils/import.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

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
        intent: z.enum(["backup", "content"]),
      })
    );

    const csvData = await csvDataFromRequest({ request });

    if (csvData.length < 2) {
      throw new ShelfError({
        cause: null,
        message: "CSV file is empty",
        additionalData: { intent },
        label: "Assets",
      });
    }

    switch (intent) {
      case "backup": {
        throw new ShelfError({
          cause: null,
          message: "This feature is not available for you",
          label: "Assets",
        });
      }
      case "content": {
        const contentData = extractCSVDataFromContentImport(csvData);
        await createAssetsFromContentImport({
          data: contentData,
          userId,
          organizationId,
        });
        return json(data(null));
      }
    }
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
      <div className="flex size-full flex-col items-center">
        <div className="h-[180px] w-full"></div>
        <Tabs defaultValue="content" className="w-1/2">
          <TabsList>
            <TabsTrigger value="content">Import your own content</TabsTrigger>
            <TabsTrigger value="backup">Import from backup</TabsTrigger>
          </TabsList>

          <TabsContent value="content">
            <ImportContent />
          </TabsContent>
          <TabsContent value="backup">
            <ImportBackup />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
