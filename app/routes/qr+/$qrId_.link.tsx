import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useMatches } from "@remix-run/react";
import { z } from "zod";
import { UnlinkIcon } from "~/components/icons/library";
import HorizontalTabs from "~/components/layout/horizontal-tabs";

import { Button } from "~/components/shared/button";

import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import {
  data,
  error,
  getActionMethod,
  getParams,
  parseData,
} from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));
  try {
    const { organizationId, organizations, currentOrganization } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.qr,
        action: PermissionAction.update,
      });

    const qr = await db.qr.findUnique({
      where: {
        id: qrId,
      },
    });

    /**
     * If for some reason this code doesnt have an org(shouldnt happen in this view)
     * we redirect to the claim page
     */
    if (!qr?.organizationId) {
      return redirect(`/qr/${qrId}/claim`);
    }

    if (qr?.organizationId && qr.organizationId !== organizationId) {
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
        organizations,
        currentOrganizationId: currentOrganization.id,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));

  try {
    const method = getActionMethod(request);

    switch (method) {
      case "POST": {
        const { organizationId, linkTo } = parseData(
          await request.formData(),
          z.object({
            organizationId: z.string(),
            linkTo: z.enum(["new", "existing"]),
          })
        );
        await claimQrCode({
          id: qrId,
          organizationId,
          userId,
        });

        /** Redirect to the relevant action. We also set the current org to the one selected, as the user could select  */
        return redirect(
          linkTo === "new"
            ? `/assets/new?qrId=${qrId}`
            : `/qr/${qrId}/link-existing-asset`,
          {
            headers: [
              setCookie(await setSelectedOrganizationIdCookie(organizationId)),
            ],
          }
        );
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrLink() {
  const { qrId } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const comesFromClaim = searchParams.get("ref") === "claim";
  const matches = useMatches();
  const currentRoute = matches[matches.length - 1];

  const isLinkPage = currentRoute?.id === "routes/qr+/$qrId_.link";

  return (
    <>
      {isLinkPage ? (
        <div className="flex flex-1 justify-center py-8">
          <div className="my-auto">
            <div className="bg-primary-100 mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 p-2 text-primary">
              <UnlinkIcon />
            </div>
            <div className="mb-8">
              <h1 className="mb-2 text-[24px] font-semibold">
                Unlinked QR Code
              </h1>
              <p className="text-color-600">
                {comesFromClaim
                  ? "Thanks for claiming the code. Now its time to link it to a kit or asset."
                  : "This code is part of your Shelf environment but is not linked with an asset. Would you like to link it?"}
              </p>
            </div>
            <div className="flex flex-col justify-center gap-2">
              <Button
                variant="primary"
                className=" max-w-full"
                to={`/assets/new?qrId=${qrId}`}
              >
                Create a new Asset and link
              </Button>
              <Button
                variant="primary"
                className=" max-w-full"
                to={`/kits/new?qrId=${qrId}`}
              >
                Create a new Kit and link
              </Button>

              <Button
                variant="secondary"
                className=" max-w-full"
                to={`/qr/${qrId}/link/asset`}
              >
                Link to existing asset/kit
              </Button>

              <Button variant="secondary" className="max-w-full" to={"/"}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          <HorizontalTabs
            items={[
              {
                to: "asset",
                content: "Assets",
              },
              {
                to: "kit",
                content: "Kits",
              },
            ]}
            className="mb-0 justify-center pl-0 [&>a]:w-full"
          />
          <div className="max-h-full">
            <Outlet />
          </div>
        </div>
      )}
    </>
  );
}
