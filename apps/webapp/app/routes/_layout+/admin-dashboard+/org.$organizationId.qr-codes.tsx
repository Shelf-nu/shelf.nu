import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Link, useLoaderData } from "react-router";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { Table, Td, Tr } from "~/components/table";
import { db } from "~/database/db.server";
import { generateOrphanedCodes } from "~/modules/qr/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { requireAdmin } from "~/utils/roles.server";

export const meta = () => [
  { title: appendToMetaTitle("Organization QR codes") },
];

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
              kit: true,
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

    return payload({ organization });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, organizationId });
    throw data(error(reason), { status: reason.status });
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
      case "createOrphans": {
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

        return payload({ message: "Generated Orphaned QR codes" });
      }
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
    return data(error(reason), { status: reason.status });
  }
};

export default function AdminOrgQrCodes() {
  const { organization } = useLoaderData<typeof loader>();
  const codes = organization?.qrCodes.sort((a, b) => {
    const aHasKitId = a.kitId !== null;
    const bHasKitId = b.kitId !== null;

    // Check if both or neither have assetId/kitId, in which case we don't change the order
    const aHasAssetOrKit = a.assetId !== null || aHasKitId;
    const bHasAssetOrKit = b.assetId !== null || bHasKitId;
    if (aHasAssetOrKit && !bHasAssetOrKit) {
      return 1; // b comes first because it has neither assetId nor kitId
    } else if (!aHasAssetOrKit && bHasAssetOrKit) {
      return -1; // a comes first because it has neither assetId nor kitId
    }

    // Among the rest, prioritize codes with a kitId

    if (aHasKitId && !bHasKitId) {
      return 1; // b comes first because it does not have a kitId but might have an assetId
    } else if (!aHasKitId && bHasKitId) {
      return -1; // a comes first because it does not have a kitId but might have an assetId
    }

    // If both have or don't have kitId, you might want to further sort them based on another criteria
    // For simplicity, let's not change the order in this case
    return 0;
  });

  const unlinkedCodes = codes.filter(
    (code) => code.assetId === null && code.kitId === null
  );
  return (
    <>
      <div className="flex justify-between">
        <div className="flex items-end gap-3">
          <h2>QR Codes</h2>
          <span>
            {organization?.qrCodes.length} total codes ({unlinkedCodes.length}{" "}
            unlinked)
          </span>
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
              Generate Unlinked QR codes
            </Button>
          </Form>
          <div className="flex justify-end gap-3">
            <Button
              to={`/api/${organization.id}/qr-codes.zip?${new URLSearchParams({
                orphaned: "true",
              })}-${new Date().getTime()}`}
              reloadDocument
              className="whitespace-nowrap"
              variant="secondary"
            >
              Print unlinked codes
            </Button>
            <Button
              to={`/api/${organization.id}/qr-codes.zip?${new URLSearchParams({
                timestamp: new Date().getTime().toString(),
              })}`}
              reloadDocument
              className="whitespace-nowrap"
              variant="secondary"
            >
              Print linked codes
            </Button>
          </div>
        </div>
      </div>
      <div className="w-full max-w-full overflow-scroll">
        <Table className="mt-5 max-w-full overflow-scroll">
          <thead className="bg-color-100">
            <tr className="font-semibold">
              <th className="border-b p-4 text-left text-color-600 md:px-6">
                QR code id
              </th>
              <th className="border-b p-4 text-left text-color-600 md:px-6">
                Asset
              </th>
              <th className="border-b p-4 text-left text-color-600 md:px-6">
                Kit
              </th>
              <th className="border-b p-4 text-left text-color-600 md:px-6">
                Created At
              </th>
            </tr>
          </thead>

          <tbody>
            {codes.map((qrCode) => (
              <Tr key={qrCode.id}>
                <Td>
                  <Link
                    to={`/qr/${qrCode.id}`}
                    className="underline hover:text-color-500"
                  >
                    {qrCode.id}
                  </Link>
                </Td>
                <Td className="whitespace-normal">
                  {!qrCode?.assetId
                    ? "N/A"
                    : `${qrCode?.asset?.title} (${qrCode?.asset?.id})`}
                </Td>
                <Td className="whitespace-normal">
                  {!qrCode?.kitId
                    ? "N/A"
                    : `${qrCode?.kit?.name} (${qrCode?.kit?.id})`}
                </Td>
                <Td>
                  <DateS
                    date={qrCode.createdAt}
                    options={{
                      timeStyle: "short",
                      dateStyle: "short",
                    }}
                  />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}
