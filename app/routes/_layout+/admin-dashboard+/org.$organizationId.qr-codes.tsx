import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { Button } from "~/components/shared/button";
import { Table, Td, Tr } from "~/components/table";
import { db } from "~/database/db.server";
import { generateOrphanedCodes } from "~/modules/qr/service.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { data, error, getParams, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const loader = async ({ context, params }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);

    const organization = await db.organization
      .findFirstOrThrow({
        where: { id: organizationId },
        include: {
          qrCodes: {
            include: {
              asset: true,
            },
          },
          owner: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Organization not found",
          message:
            "The organization you are trying to access does not exist or you do not have permission to access it.",
          additionalData: { userId, params },
          label: "Admin dashboard",
        });
      });

    return json(data({ organization }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    throw json(error(reason), { status: reason.status });
  }
};

export const action = async ({
  context,
  request,
  params,
}: ActionFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { organizationId } = getParams(
    params,
    z.object({ organizationId: z.string() }),
    { additionalData: { userId } }
  );

  try {
    await requireAdmin(userId);
    const { intent } = parseData(
      await request.clone().formData(),
      z.object({
        intent: z.enum(["createOrphans"]),
      })
    );

    switch (intent) {
      case "createOrphans":
        const { amount, userId: ownerId } = parseData(
          await request.formData(),
          z.object({
            amount: z.coerce.number(),
            userId: z.string(),
          })
        );

        await generateOrphanedCodes({
          organizationId,
          userId: ownerId,
          amount,
        });

        return json(data({ message: "Generated Orphaned QR codes" }));
      default:
        throw new ShelfError({
          cause: null,
          title: "Invalid intent",
          message: "The intent provided is not valid",
          additionalData: { intent },
          label: "Admin dashboard",
        });
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    return json(error(reason), { status: reason.status });
  }
};

export default function AdminOrgQrCodes() {
  const { organization } = useLoaderData<typeof loader>();
  return (
    <>
      <div className="flex justify-between">
        <div className="flex items-end gap-3">
          <h2>QR Codes</h2>
          <span>{organization?.qrCodes.length} total codes</span>
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
            <input type="hidden" name="userId" value={organization.owner.id} />
            <Button
              type="submit"
              to={""}
              variant="secondary"
              name="intent"
              value="createOrphans"
            >
              Generate Orphaned QR codes
            </Button>
          </Form>
          <div className="flex justify-end gap-3">
            <Button
              to={`/api/${organization.id}/qr-codes.zip?${new URLSearchParams({
                orphaned: "true",
              })}`}
              reloadDocument
              className="whitespace-nowrap"
              variant="secondary"
            >
              Print orphaned codes
            </Button>
            <Button
              to={`/api/${organization.id}/qr-codes.zip`}
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
          {organization?.qrCodes.map((qrCode) => (
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
    </>
  );
}
