import { json, type LoaderArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { Table, Td, Tr } from "~/components/table";
import { db } from "~/database";
import { requireAdmin } from "~/utils/roles.servers";

export const loader = async ({ request, params }: LoaderArgs) => {
  requireAdmin(request);
  const userId = params.userId as string;
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { qrCodes: true },
  });

  return json({ user });
};

export default function Area51UserPage() {
  const { user } = useLoaderData<typeof loader>();
  return (
    <div>
      <div>
        <h1>User: {user?.email}</h1>
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
        <h2>QR Codes</h2>
        <Table className="mt-5">
          <thead className="bg-gray-100">
            <tr className="font-semibold">
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                QR code id
              </th>
              <th className="border-b p-4 text-left text-gray-600 md:px-6">
                Asset id
              </th>
            </tr>
          </thead>

          <tbody>
            {user?.qrCodes.map((qrCode) => (
              <Tr key={qrCode.id}>
                <Td>
                  <Link
                    to={`/qr/${qrCode.id}`}
                    className="underline hover:text-gray-500"
                  >
                    {qrCode.id}
                  </Link>
                </Td>
                <Td>{qrCode.assetId ? qrCode.assetId : "Orphaned"}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
