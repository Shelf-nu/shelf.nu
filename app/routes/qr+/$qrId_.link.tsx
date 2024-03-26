import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { UnlinkIcon } from "~/components/icons";
import ContextualModal from "~/components/layout/contextual-modal";
import { Button } from "~/components/shared";
import { db } from "~/database";
import { data, error, getParams, makeShelfError, ShelfError } from "~/utils";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });
    /** @TODO here we have to double check if the QR is orpaned, and if its not, redirect */

    const qr = await db.qr.findUnique({
      where: {
        id: qrId,
        organizationId,
      },
    });

    if (!qr) {
      throw new ShelfError({
        message: "This QR code doesn't belong to your current organization.",
        title: "Not allowed",
        label: "QR",
        status: 403,
        cause: null,
      });
    }

    return json(
      data({
        header: {
          title: "Link QR with asset",
        },
        qrId,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrLink() {
  const { qrId } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <UnlinkIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">Unlinked QR Code</h1>
            <p className="text-gray-600">
              This code is part of your Shelf environment but is not linked with
              an asset. Would you like to link it?
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <Button
              variant="primary"
              className=" max-w-full"
              to={`/assets/new?qrId=${qrId}`}
            >
              Create a new asset and link
            </Button>
            <Button
              variant="secondary"
              className=" max-w-full"
              to={`/qr/${qrId}/link-existing-asset`}
            >
              Link to existing asset
            </Button>
            <Button variant="secondary" className="max-w-full" to={"/"}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
      <ContextualModal />
    </>
  );
}
