import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useFetcher, useLoaderData } from "@remix-run/react";
import { Switch } from "~/components/forms/switch";
import { MarkdownViewer } from "~/components/markdown";
import { Button } from "~/components/shared";
import { Table, Td, Th, Tr } from "~/components/table";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await requireAuthSession(request);
  await requireAdmin(request);

  const announcements = await db.announcement.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return json({ announcements });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await requireAuthSession(request);
  await requireAdmin(request);
  const formData = await request.formData();
  const published = formData.get("published") === "on";
  const announcementId = formData.get("id") as string;

  await db.announcement.update({
    where: {
      id: announcementId,
    },
    data: {
      published,
    },
  });

  return null;
};

export default function Announcements() {
  const { announcements } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  return (
    <div>
      <div className="flex justify-between">
        <h2>Announcements</h2>
        <Button variant="primary" to="new">
          New
        </Button>
      </div>
      <p className="mb-8 text-left">
        The latest announcement will be visible on the user's dashboard.
      </p>
      <Outlet />

      <div className="mt-8">
        <Table>
          <thead>
            <Tr className="text-left">
              <Th>Name</Th>
              <Th>Content</Th>
              <Th>Link</Th>
              <Th>Link Text</Th>
              <Th>Published</Th>
            </Tr>
          </thead>
          <tbody>
            {announcements.map((a) => (
              <Tr key={a.id}>
                <Td>{a.name}</Td>
                <Td>
                  <MarkdownViewer content={a.content} />
                </Td>
                <Td>{a.link}</Td>
                <Td>{a.linkText}</Td>
                <Td>
                  <fetcher.Form
                    method="post"
                    onChange={(e) => {
                      e.preventDefault();
                      fetcher.submit(e.currentTarget);
                    }}
                  >
                    <input type="hidden" name="id" value={a.id} />
                    <Switch
                      name={`published`}
                      defaultChecked={a.published}
                      required
                    />
                  </fetcher.Form>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
