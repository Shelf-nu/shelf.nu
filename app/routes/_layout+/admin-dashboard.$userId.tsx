import type { Qr, User } from "@prisma/client";
import type { ActionArgs, LoaderArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, Link } from "@remix-run/react";
import { Button } from "~/components/shared";
import { Table, Td, Tr } from "~/components/table";
import { DeleteUser } from "~/components/user/delete-user";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { generateOrphanedCodes } from "~/modules/qr";
import { deleteUser } from "~/modules/user";
import { isDelete } from "~/utils";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { requireAdmin } from "~/utils/roles.servers";

export type UserWithQrCodes = User & {
  qrCodes: Qr[];
};

export const loader = async ({ request, params }: LoaderArgs) => {
  requireAdmin(request);
  const userId = params.userId as string;
  const user = (await db.user.findUnique({
    where: { id: userId },
    include: {
      qrCodes: {
        orderBy: { createdAt: "desc" },
      },
    },
  })) as UserWithQrCodes;

  return json({ user });
};

export const handle = {
  breadcrumb: () => "User details",
};

export const action = async ({ request, params }: ActionArgs) => {
  const authSession = await requireAuthSession(request);
  await requireAdmin(request);
  const formData = await request.formData();
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
  } else {
    await generateOrphanedCodes({
      userId,
      amount: Number(formData.get("amount")),
    });
    return json({ message: "Generated Orphaned QR codes" });
  }
};

export default function Area51UserPage() {
  const { user } = useLoaderData<typeof loader>();
  return user ? (
    <div>
      <div>
        <div className="flex justify-between">
          <h1>User: {user?.email}</h1>
          <div className="flex gap-3">
            <DeleteUser user={user} />
            <Button
              to={`/api/${user?.id}/orphaned-codes.zip`}
              reloadDocument
              className="whitespace-nowrap"
            >
              Print orphaned codes
            </Button>
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
        <div className="flex justify-between">
          <div className="flex items-end gap-3">
            <h2>QR Codes</h2>
            <span>{user?.qrCodes.length} total codes</span>
          </div>
          <Form method="post">
            <input
              type="number"
              max={1000}
              min={1}
              name="amount"
              required
              defaultValue={10}
            />
            <Button type="submit" to={""}>
              Generate Orphaned QR codes
            </Button>
          </Form>
        </div>
        <Table className="mt-5">
          <thead className="bg-gray-100">
            <tr className="font-semibold">
              <th className="border-b p-4 text-left text-gray-600 md:px-6" />
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                QR code id
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Asset id
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Created At
              </th>
            </tr>
          </thead>

          <tbody>
            {user?.qrCodes.map((qrCode) => (
              <Tr key={qrCode.id}>
                <Td className="w-1">
                  <input type="checkbox" name="qrId" value={qrCode.id} />
                </Td>
                <Td>
                  <Link
                    to={`/qr/${qrCode.id}`}
                    className="underline hover:text-gray-500"
                  >
                    {qrCode.id}
                  </Link>
                </Td>
                <Td>{qrCode.assetId ? qrCode.assetId : "Orphaned"}</Td>
                <Td>{qrCode.createdAt}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  ) : null;
}
