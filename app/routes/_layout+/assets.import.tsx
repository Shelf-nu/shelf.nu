import { OrganizationType } from "@prisma/client";
import type { ActionArgs, V2_MetaFunction, LoaderArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link } from "@remix-run/react";
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
import {
  createAssetsFromBackupImport,
  createAssetsFromContentImport,
} from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { assertUserCanImportAssets } from "~/modules/tier";
import { csvDataFromRequest } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  extractCSVDataFromBackupImport,
  extractCSVDataFromContentImport,
} from "~/utils/import.server";

export const action = async ({ request }: ActionArgs) => {
  const { userId } = await requireAuthSession(request);

  try {
    const { user } = await assertUserCanImportAssets({ userId });

    const intent = (await request.clone().formData()).get("intent") as string;
    const personalOrg = user?.organizations.find(
      (org) => org.type === OrganizationType.PERSONAL
    );
    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new Error("CSV file is empty");
    }

    switch (intent) {
      case "backup":
        const backupData = extractCSVDataFromBackupImport(csvData);
        await createAssetsFromBackupImport({
          data: backupData,
          userId,
          organizationId: personalOrg?.id || "",
        });
        // return null;
        return json({ success: true });
      case "content":
        const contentData = extractCSVDataFromContentImport(csvData);
        await createAssetsFromContentImport({
          data: contentData,
          userId,
          organizationId: personalOrg?.id || "",
        });
        return null;
      // return json({ success: true });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CSV file";

    return json({ error: { message } }, { status: 400 });
  }
};

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);
  await assertUserCanImportAssets({ userId });

  return json({
    header: {
      title: "Import assets (beta)",
    },
  });
};

export const meta: V2_MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <Link to="/import">Import</Link>,
};

export default function AssetsImport() {
  return (
    <div className="h-full">
      <Header />
      <div className="flex h-full w-full flex-col items-center">
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
