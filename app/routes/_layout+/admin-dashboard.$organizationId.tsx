import type { Asset, Qr, User } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, Link } from "@remix-run/react";
import { Button } from "~/components/shared";
import { Table, Td, Tr } from "~/components/table";
import { DeleteUser } from "~/components/user/delete-user";
import { db } from "~/database";
import { requireAuthSession } from "~/modules/auth";
import { getRequiredParam } from "~/utils";
import { ShelfStackError } from "~/utils/error";
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
  const organizationId = params.organizationId as string;

  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    include: {
      owner: true,
      qrCodes: {
        include: {
          asset: {
            select: {
              title: true,
            },
          },
        },
      },
    },
  });
  if (!organization) {
    throw new ShelfStackError({
      message: "Org not found",
      status: 404,
    });
  }

  return json({ organization });
};

export const handle = {
  breadcrumb: () => "Organization details",
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const authSession = await requireAuthSession(request);
  await requireAdmin(request);
  const organizationId = getRequiredParam(params, "organizationId");
  // const formData = await request.formData();
  // /** ID of the target user we are generating codes for */
  // const userId = params.userId as string;

  // if (isDelete(request)) {
  //   await deleteUser(userId);

  //   sendNotification({
  //     title: "User deleted",
  //     message: "The user has been deleted successfully",
  //     icon: { name: "trash", variant: "error" },
  //     senderId: authSession.userId,
  //   });
  //   return redirect("/admin-dashboard");
  // } else {
  //   await generateOrphanedCodes({
  //     organizationId,
  //     userId,
  //     amount: Number(formData.get("amount")),
  //   });
  //   return json({ message: "Generated Orphaned QR codes" });
  // }
};

export default function Area51UserPage() {
  const { organization } = useLoaderData<typeof loader>();
  const { owner, qrCodes } = organization;
  return owner ? (
    <div>
      <div>
        <div className="flex justify-between">
          <div className="flex gap-3">
            <DeleteUser user={owner} />
          </div>
        </div>
        <ul className="mt-5">
          <h5>Organization - {organization.name}</h5>
          {organization
            ? Object.entries(organization).map(([key, value]) => (
                <li key={key}>
                  <span className="font-semibold">{key}</span>:{" "}
                  {typeof value === "string" ? value : null}
                  {typeof value === "boolean" ? String(value) : null}
                </li>
              ))
            : null}
        </ul>
        <ul className="mt-5">
          <h5>
            Owner - {owner.firstName} {owner.lastName} {owner.email}
          </h5>
          {owner
            ? Object.entries(owner).map(([key, value]) => (
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
            <span>{qrCodes.length} total codes</span>
          </div>
          <div className="flex flex-col justify-end gap-3">
            <Form method="post">
              <input
                type="number"
                max={1000}
                min={1}
                name="amount"
                required
                defaultValue={10}
              />
              <Button type="submit" to={""} variant="secondary">
                Generate Orphaned QR codes
              </Button>
            </Form>
            <div className="flex justify-end gap-3">
              <Button
                to={`/api/${owner?.id}/qr-codes.zip?${new URLSearchParams({
                  orphaned: "true",
                })}`}
                reloadDocument
                className="whitespace-nowrap"
                variant="secondary"
              >
                Print orphaned codes
              </Button>
              <Button
                to={`/api/${owner?.id}/qr-codes.zip`}
                reloadDocument
                className="whitespace-nowrap"
                variant="secondary"
              >
                Print non-orphaned codes
              </Button>
            </div>
          </div>
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
                Asset name
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Created At
              </th>
            </tr>
          </thead>

          <tbody>
            {qrCodes.map((qrCode) => (
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
                <Td>{qrCode?.assetId || "Orphaned"}</Td>
                <Td>{qrCode?.asset?.title || "Orphaned"}</Td>
                <Td>{qrCode.createdAt}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  ) : null;
}
