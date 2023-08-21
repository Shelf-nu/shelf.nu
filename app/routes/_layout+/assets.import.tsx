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
import { db } from "~/database";
import { createAssetsFromContentImport } from "~/modules/asset";
import { requireAuthSession } from "~/modules/auth";
import { csvDataFromRequest } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const action = async ({ request }: ActionArgs) => {
  const { userId } = await requireAuthSession(request);
  const intent = (await request.clone().formData()).get("intent") as string;

  const personalOrg = await db.organization.findFirst({
    where: {
      userId,
      type: OrganizationType.PERSONAL,
    },
    select: {
      id: true,
    },
  });

  try {
    const csvData = await csvDataFromRequest({ request });
    if (csvData.length < 2) {
      throw new Error("CSV file is empty");
    }

    switch (intent) {
      case "backup":
        break;
      case "content":
        const keys = csvData[0] as string[];
        const values = csvData.slice(1) as string[][];
        const data = values.map((entry) =>
          Object.fromEntries(
            entry.map((value, index) => {
              switch (keys[index]) {
                case "tags":
                  return [keys[index], value.split(",")];
                default:
                  return [keys[index], value];
              }
            })
          )
        );

        const result = await createAssetsFromContentImport({
          data,
          userId,
          organizationId: personalOrg?.id || "",
        });
    }

    return json({ csvData });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CSV file";

    return json({ error: { message } }, { status: 400 });
  }
};

export const loader = async ({ request }: LoaderArgs) => {
  await requireAuthSession(request);

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
