import type { Asset, Qr, User } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { z } from "zod";
import { Table, Td, Tr } from "~/components/table";
import { DeleteUser } from "~/components/user/delete-user";
import { db } from "~/database/db.server";
import { deleteUser } from "~/modules/user/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams, isDelete } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export type QrCodeWithAsset = Qr & {
  asset: {
    title: Asset["title"];
  };
};

export type UserWithQrCodes = User & {
  qrCodes: QrCodeWithAsset[];
};

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { userId: shelfUserId } = getParams(
    params,
    z.object({ userId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    const user = await db.user
      .findUnique({
        where: { id: shelfUserId },
        include: {
          qrCodes: {
            orderBy: { createdAt: "desc" },
            include: {
              asset: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load shelf user",
          additionalData: { userId, shelfUserId },
          label: "Admin dashboard",
        });
      });

    const organizations = await db.organization
      .findMany({
        where: {
          owner: {
            id: userId,
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Failed to load user organizations",
          additionalData: { userId, shelfUserId },
          label: "Admin dashboard",
        });
      });

    return json(data({ user, organizations }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, shelfUserId });
    throw json(error(reason), { status: reason.status });
  }
};

export const handle = {
  breadcrumb: () => "User details",
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { userId: shelfUserId } = getParams(
    params,
    z.object({ userId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    if (isDelete(request)) {
      await deleteUser(shelfUserId);

      sendNotification({
        title: "User deleted",
        message: "The user has been deleted successfully",
        icon: { name: "trash", variant: "error" },
        senderId: userId,
      });

      return redirect("/admin-dashboard");
    }

    return json(data(null));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, shelfUserId });
    return json(error(reason), { status: reason.status });
  }
};

export default function Area51UserPage() {
  const { user, organizations } = useLoaderData<typeof loader>();
  return user ? (
    <div>
      <div>
        <div className="flex justify-between">
          <h1>User: {user?.email}</h1>
          <div className="flex gap-3">
            <DeleteUser user={user} />
          </div>
        </div>
        <ul className="mt-5">
          {user
            ? Object.entries(user).map(([key, value]) => (
                <li key={key}>
                  <span className="font-semibold">{key}</span>:{" "}
                  {typeof value === "string" ? value : null}
                  {typeof value === "boolean" ? String(value) : null}
                </li>
              ))
            : null}
        </ul>
      </div>
      <div className="mt-10">
        <Table>
          <thead>
            <tr>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Name
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Type
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Created at
              </th>
            </tr>
          </thead>
          <tbody>
            {organizations.map((org) => (
              <Tr key={org.id}>
                <Td>
                  <Link
                    to={`/admin-dashboard/org/${org.id}`}
                    className="underline hover:text-gray-500"
                  >
                    {org.name}
                  </Link>
                </Td>
                <Td>{org.type}</Td>
                <Td>{org.createdAt}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  ) : null;
}
