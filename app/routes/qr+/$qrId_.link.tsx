import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Outlet, useLoaderData, useMatches } from "@remix-run/react";
import { UnlinkIcon } from "~/components/icons";
import { Button } from "~/components/shared";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { PermissionAction, PermissionEntity } from "~/utils/permissions";
import { requirePermision } from "~/utils/roles.server";
import type { RouteHandleWithName } from "../_layout+/bookings";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  await requirePermision({
    userId: authSession.userId,
    request,
    entity: PermissionEntity.qr,
    action: PermissionAction.update,
  });
  const { qrId } = params;
  return json({
    header: {
      title: "Link QR with asset",
    },
    qrId,
  });
};
export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrLink() {
  const { qrId } = useLoaderData<typeof loader>();
  const matches = useMatches();

  const currentRoute: RouteHandleWithName = matches[matches.length - 1];
  /**
   * We have 2 cases when we should render index:
   * 1. When we are on the index route
   * 2. When we are on the .new route - the reason we do this is because we want to have the .new modal overlaying the index.
   */
  const shouldRenderOutlet = currentRoute?.pathname.includes("existing-asset");

  return shouldRenderOutlet ? (
    <Outlet />
  ) : (
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
              to={`existing-asset?linkQrId=${qrId}`}
            >
              Link to existing asset
            </Button>
            <Button variant="secondary" className="max-w-full" to={"/"}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
