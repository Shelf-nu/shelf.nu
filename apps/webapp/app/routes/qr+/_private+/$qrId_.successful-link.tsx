import type { MetaFunction, LoaderFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";

import { ErrorContent } from "~/components/errors";
import { LinkIcon } from "~/components/icons/library";

import { Button } from "~/components/shared/button";

import { db } from "~/database/db.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { normalizeQrData } from "~/utils/qr";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    // why: org-scope the QR lookup. Without organizationId an authenticated
    // user in any workspace could read another tenant's QR (and the linked
    // asset title / kit name) just by guessing the QR id — cross-org IDOR.
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    const qr = await db.qr.findFirst({
      where: { id: qrId, organizationId },
      select: {
        id: true,
        assetId: true,
        kitId: true,

        asset: {
          select: {
            id: true,
            title: true,
          },
        },
        kit: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!qr) {
      throw new ShelfError({
        cause: null,
        message: "The QR you are trying to access does not exist.",
        title: "QR not found",
        label: "QR",
        status: 404,
      });
    }

    return payload({
      header: {
        title: "Successfully linked asset to QR code",
      },
      qr,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, qrId });
    throw data(error(reason), { status: reason.status });
  }
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrSuccessfullLink() {
  const { qr } = useLoaderData<typeof loader>();
  const { item, type, normalizedName } = normalizeQrData(qr);

  if (!item || !type) {
    return null;
  }

  return (
    <>
      <div className="flex max-h-full flex-1 flex-col items-center justify-center ">
        <span className="mb-2.5 flex size-12 items-center justify-center rounded-full bg-success-50 p-2 text-success-600">
          <LinkIcon />
        </span>
        <h3>Succesfully linked</h3>
        <p>
          Your {type} <b>{normalizedName}</b> has been linked with this QR code.
        </p>
        <div className="mt-8 flex w-full flex-col gap-3">
          <Button
            to={`/${type === "asset" ? "assets" : "kits"}/${item.id}`}
            width="full"
            variant="secondary"
          >
            View {type}
          </Button>
          <Button to={`/scanner`} width="full">
            Go to scanner
          </Button>
        </div>
      </div>
    </>
  );
}

export const ErrorBoundary = () => <ErrorContent />;
