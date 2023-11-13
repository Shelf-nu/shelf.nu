import type { Asset, Qr, User } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { Table, Td, Tr } from "~/components/table";
import { DeleteUser } from "~/components/user/delete-user";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { deleteUser } from "~/modules/user";
import { isDelete } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { requireAdmin } from "~/utils/roles.server";

export type QrCodeWithAsset = Qr & {
  asset: {
    title: Asset["title"];
  };
};

export type UserWithQrCodes = User & {
  qrCodes: QrCodeWithAsset[];
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  requireAdmin(request);
  const userId = params.userId as string;
  const user = (await db.user.findUnique({
    where: { id: userId },
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
  })) as UserWithQrCodes;

  const organizations = await db.organization.findMany({
    where: {
      owner: {
        id: userId,
      },
    },
  });

  return json({ user, organizations });
};

export const handle = {
  breadcrumb: () => "User details",
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  await requireAdmin(request);
  /** ID of the target user we are generating codes for */
  const userId = params.userId as string;

  if (isDelete(request)) {
    await deleteUser(userId);

    sendNotification({
      title: "User deleted",
      message: "The user has been deleted successfully",
      icon: { name: "trash", variant: "error" },
      senderId: authSession.userId,
    });
    return redirect("/admin-dashboard");
  }
  return null;
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
