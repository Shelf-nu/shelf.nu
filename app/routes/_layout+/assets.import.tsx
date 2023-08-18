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
import { requireAuthSession } from "~/modules/auth";
import { csvDataFromRequest } from "~/utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";

export const action = async ({ request }: ActionArgs) => {
  const { userId } = await requireAuthSession(request);
  const intent = (await request.clone().formData()).get("intent") as string;
  // const clonedRequest = request.clone();
  // const formData = await clonedRequest.formData();
  // const intent = formData.get("intent") as string;

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
                  // return [keys[index], value.split(",")];
                  return [
                    keys[index],
                    value.split(",").map((tag) => ({
                      connectOrCreate: {
                        where: {
                          name: tag,
                        },
                        create: {
                          name: tag,
                        },
                      },
                    })),
                  ];
                default:
                  return [keys[index], value];
              }
            })
          )
        );
        console.log(data[0].tags);

        const u = await db.user.update({
          where: {
            id: userId,
          },
          data: {
            assets: {
              createMany: {
                data,
              },
            },
          },
        });

      // console.log(assets);
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
