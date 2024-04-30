import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { z } from "zod";
import Icon from "~/components/icons/icon";
import { UnlinkIcon } from "~/components/icons/library";
import ContextualModal from "~/components/layout/contextual-modal";
import { OrganizationSelect } from "~/components/layout/sidebar/organization-select";
import type { ButtonProps } from "~/components/shared/button";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { db } from "~/database/db.server";
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
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { qrId } = getParams(params, z.object({ qrId: z.string() }));
  let claimed = false;
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

    /** We set claimed to true if the qr already belongs to an organization */
    if (qr?.organizationId) {
      claimed = true;
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
          title: claimed
            ? "Link QR with asset"
            : "Claim QR code for your organization",
        },
        qrId,
        claimed,
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
  const { qrId, claimed } = useLoaderData<typeof loader>();

  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <UnlinkIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">
              {claimed ? "Unlinked QR Code" : "Unclaimed QR Code"}
            </h1>
            <p className="text-gray-600">
              {claimed
                ? "This code is part of your Shelf environment but is not linked with an asset. Would you like to link it?"
                : "This code is an unclaimed code which is not part of any organization. Would you like to claim it?"}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2">
            {claimed ? (
              <Button
                variant="primary"
                className=" max-w-full"
                to={`/assets/new?qrId=${qrId}`}
              >
                Create a new asset and link
              </Button>
            ) : (
              <ConfirmOrganizationClaim
                buttonText="Claim and link to a new asset"
                linkTo="new"
                buttonProps={{
                  width: "full",
                }}
              />
            )}

            {claimed ? (
              <Button
                variant="secondary"
                className=" max-w-full"
                to={`/qr/${qrId}/link-existing-asset`}
              >
                {claimed
                  ? "Link to existing asset"
                  : "Claim and link to existing asset"}
              </Button>
            ) : (
              <ConfirmOrganizationClaim
                buttonText="Claim and link to existing asset"
                linkTo="existing"
                buttonProps={{
                  variant: "secondary",
                  width: "full",
                }}
              />
            )}

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

type LinkTo = "new" | "existing";

const ConfirmOrganizationClaim = ({
  buttonText,
  buttonProps,
  linkTo,
}: {
  buttonText: string;
  buttonProps?: ButtonProps;
  linkTo: LinkTo;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button {...buttonProps}>{buttonText}</Button>
    </AlertDialogTrigger>

    <AlertDialogContent>
      <Form method="post" className="w-full">
        <AlertDialogHeader className="text-left">
          <div className="md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary-600">
              <Icon icon="scanQR" />
            </span>
          </div>
          <div className="my-5">
            <h4>Claim QR code for your organization</h4>
            <p>
              Please select an organization to which you would like to claim
              this QR
            </p>
          </div>
        </AlertDialogHeader>
        <div className="my-5">
          <OrganizationSelect />
        </div>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary" width="full" type="button">
                Cancel
              </Button>
            </AlertDialogCancel>
            <input type="hidden" name="linkTo" value={linkTo} />
            <Button type="submit" width="full">
              Confirm
            </Button>
          </div>
        </AlertDialogFooter>
      </Form>
    </AlertDialogContent>
  </AlertDialog>
);
