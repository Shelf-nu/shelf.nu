import { UpdateStatus } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useFetcher, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Switch } from "~/components/forms/switch";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Table, Td, Th, Tr } from "~/components/table";
import {
  getAllUpdatesForAdmin,
  updateUpdate,
} from "~/modules/update/service.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const updates = await getAllUpdatesForAdmin();

    return json(data({ updates }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({ context, request }: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    await requireAdmin(userId);

    const { status, id: updateId } = parseData(
      await request.formData(),
      z.object({
        status: z.nativeEnum(UpdateStatus),
        id: z.string(),
      })
    );

    await updateUpdate({
      id: updateId,
      status,
    });

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
};

export default function Updates() {
  const { updates } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const getRoleBadges = (targetRoles: string[]) => {
    if (targetRoles.length === 0) {
      return <Badge color="gray">All roles</Badge>;
    }
    return targetRoles.map((role) => (
      <Badge key={role} color="blue" className="mr-1">
        {role}
      </Badge>
    ));
  };

  return (
    <div>
      <div className="flex justify-between">
        <h2>Updates</h2>
        <Button variant="primary" to="new">
          New Update
        </Button>
      </div>
      <p className="mb-8 text-left">
        Manage updates that appear in the sidebar for users. Target specific
        roles or make them visible to all users.
      </p>
      <Outlet />

      <div className="mt-8">
        <Table>
          <thead>
            <Tr className="text-left">
              <Th>Title</Th>
              <Th>Content</Th>
              <Th>URL</Th>
              <Th>Target Roles</Th>
              <Th>Publish Date</Th>
              <Th>Analytics</Th>
              <Th>Status</Th>
              <Th>Created By</Th>
              <Th>Actions</Th>
            </Tr>
          </thead>
          <tbody>
            {updates.map((update) => (
              <Tr key={update.id}>
                <Td className="max-w-48">
                  <div className="truncate font-medium">{update.title}</div>
                </Td>
                <Td className="max-w-64">
                  <div className="truncate text-sm">
                    {update.content.substring(0, 100)}
                    {update.content.length > 100 && "..."}
                  </div>
                </Td>
                <Td className="max-w-48">
                  {update.url ? (
                    <a
                      href={update.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-blue-600 underline hover:text-blue-800"
                    >
                      {update.url}
                    </a>
                  ) : (
                    <span className="text-sm text-gray-400">No URL</span>
                  )}
                </Td>
                <Td>{getRoleBadges(update.targetRoles)}</Td>
                <Td className="text-sm">
                  <DateS date={update.publishDate} />
                </Td>
                <Td className="text-sm">
                  <div>Views: {update.viewCount}</div>
                  <div>Clicks: {update.clickCount}</div>
                  <div>Read by: {update._count.userReads}</div>
                </Td>
                <Td>
                  <fetcher.Form
                    method="post"
                    onChange={(e) => {
                      e.preventDefault();
                      fetcher.submit(e.currentTarget);
                    }}
                  >
                    <input type="hidden" name="id" value={update.id} />
                    <Switch
                      name="status"
                      value={UpdateStatus.PUBLISHED}
                      defaultChecked={update.status === UpdateStatus.PUBLISHED}
                      required
                    />
                    <input
                      type="hidden"
                      name="status"
                      value={
                        update.status === UpdateStatus.PUBLISHED
                          ? UpdateStatus.DRAFT
                          : UpdateStatus.PUBLISHED
                      }
                    />
                  </fetcher.Form>
                </Td>
                <Td className="text-sm">
                  {update.createdBy.firstName} {update.createdBy.lastName}
                </Td>
                <Td>
                  <Button
                    variant="secondary"
                    size="sm"
                    to={`${update.id}/edit`}
                  >
                    Edit
                  </Button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>

        {updates.length === 0 && (
          <div className="py-8 text-center text-gray-500">
            <p>No updates created yet.</p>
            <Button variant="primary" to="new" className="mt-4">
              Create your first update
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
