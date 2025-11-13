import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Outlet, useFetcher, useLoaderData } from "react-router";
import { z } from "zod";
import { Switch } from "~/components/forms/switch";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Button } from "~/components/shared/button";
import { Table, Td, Th, Tr } from "~/components/table";
import { db } from "~/database/db.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { parseMarkdownToReact } from "~/utils/md";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const announcements = await db.announcement
      .findMany({
        orderBy: {
          createdAt: "desc",
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load announcements",
          additionalData: { userId },
          label: "Admin dashboard",
        });
      });

    return payload({
      announcements: announcements.map((a) => ({
        ...a,
        content: parseMarkdownToReact(a.content),
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
};

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const { published, id: announcementId } = parseData(
      await request.formData(),
      z.object({
        published: z.coerce.boolean(),
        id: z.string(),
      })
    );

    await db.announcement
      .update({
        where: {
          id: announcementId,
        },
        data: {
          published,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to update announcement",
          additionalData: { userId, published, announcementId },
          label: "Admin dashboard",
        });
      });

    return payload(null);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
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
                      void fetcher.submit(e.currentTarget);
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
