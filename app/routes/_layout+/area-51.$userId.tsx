import type { ActionArgs } from "@remix-run/node";
import { json, type LoaderArgs } from "@remix-run/node";
import { Form, useLoaderData, Link } from "@remix-run/react";
import { Button } from "~/components/shared";
import { Table, Td, Tr } from "~/components/table";
import { db } from "~/database";
import { generateOrphanedCodes } from "~/modules/qr";
import { requireAdmin } from "~/utils/roles.servers";

export const loader = async ({ request, params }: LoaderArgs) => {
  requireAdmin(request);
  const userId = params.userId as string;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      qrCodes: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return json({ user });
};

export const action = async ({ request }: ActionArgs) => {
  const { id } = await requireAdmin(request);
  const formData = await request.formData();

  await generateOrphanedCodes({
    userId: id,
    amount: Number(formData.get("amount")),
  });
  return json({ message: "Generated 10 Orphaned QR codes" });
};

export default function Area51UserPage() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <div>
      <div>
        <div className="flex justify-between">
          <h1>User: {user?.email}</h1>
          <div>
            <Button to={`/api/${user?.id}/orphaned-codes.zip`} reloadDocument>
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
              max={100}
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
                <Td>
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
                <Td>{new Date(qrCode.createdAt).toLocaleDateString()}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
