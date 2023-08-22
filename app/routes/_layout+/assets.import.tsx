import type { Asset } from "@prisma/client";
import { OrganizationType } from "@prisma/client";
import type { ActionArgs, V2_MetaFunction, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Link, useActionData } from "@remix-run/react";
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
import { assetUserCanImportAssets, getUserTierLimit } from "~/modules/tier";
import { csvDataFromRequest } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const action = async ({ request }: ActionArgs) => {
  const { userId } = await requireAuthSession(request);
  await assetUserCanImportAssets({ userId });

  const intent = (await request.clone().formData()).get("intent") as string;

  try {
    /* Get the user by selecting the org and tierLimit */
    const user = await db.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        organizations: {
          select: {
            id: true,
            type: true,
          },
        },
        tier: {
          include: { tierLimit: true },
        },
      },
    });

    if (user?.tier?.tierLimit && !user.tier.tierLimit.canImportAssets) {
      throw new Error("You don't have the required plan to import assets.");
    }

    const personalOrg = user?.organizations.find(
      (org) => org.type === OrganizationType.PERSONAL
    );
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
                  return [
                    keys[index],
                    value.split(",").map((tag) => tag.trim()),
                  ];
                default:
                  return [keys[index], value];
              }
            })
          )
        );

        await createAssetsFromContentImport({
          data,
          userId,
          organizationId: personalOrg?.id || "",
        });
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CSV file";

    return json({ error: { message } }, { status: 400 });
  }
};

export const loader = async ({ request }: LoaderArgs) => {
  const { userId } = await requireAuthSession(request);
  await assetUserCanImportAssets({ userId });

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
  const data = useActionData<typeof action>();
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
