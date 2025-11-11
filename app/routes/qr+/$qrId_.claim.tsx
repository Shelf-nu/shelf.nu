import type { MetaFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { data, redirect } from "react-router";
import { useNavigation } from "react-router";
import { z } from "zod";
import { Form } from "~/components/custom-form";
import { UnlinkIcon } from "~/components/icons/library";
import { OrganizationSelect } from "~/components/layout/sidebar/organization-select";
import { Button } from "~/components/shared/button";

import { db } from "~/database/db.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import { claimQrCode } from "~/modules/qr/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { setCookie } from "~/utils/cookies.server";
import { makeShelfError, notAllowedMethod, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import {
  payload,
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
    const { organizations, currentOrganization } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.update,
    });

    const qr = await db.qr
      .findUniqueOrThrow({
        where: {
          id: qrId,
          assetId: null,
          kitId: null,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          title: "Code not found",
          message:
            "The code you are trying to claim is not available for claiming.",
          additionalData: { qrId, currentOrganization },
          label: "QR",
        });
      });

    /** If for some reason its already claimed, redirect to link */
    if (qr?.organizationId) {
      return redirect(`/qr/${qrId}/link`);
    }

    return payload({
      header: {
        title: "Claim QR code for your organization",
      },
      qrId,
      organizations,
      currentOrganizationId: currentOrganization.id,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
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
        const { organizationId } = parseData(
          await request.formData(),
          z.object({
            organizationId: z.string(),
          })
        );

        await claimQrCode({
          id: qrId,
          organizationId,
          userId,
        });

        /** Redirect to the relevant action. We also set the current org to the one selected, as the user could select  */
        return redirect(`/qr/${qrId}/link?ref=claim`, {
          headers: [
            setCookie(await setSelectedOrganizationIdCookie(organizationId)),
          ],
        });
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export default function QrLink() {
  const navigation = useNavigation();
  const disabled = isFormProcessing(navigation.state);
  return (
    <>
      <div className="flex flex-1 justify-center py-8">
        <div className="my-auto">
          <div className="mb-4 inline-flex items-center justify-center rounded-full border-8 border-solid border-primary-50 bg-primary-100 p-2 text-primary">
            <UnlinkIcon />
          </div>
          <div className="mb-8">
            <h1 className="mb-2 text-[24px] font-semibold">
              Unclaimed QR Code
            </h1>
            <p className="text-gray-600">
              Select the workspace for which you want to claim the QR code.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2">
            <Form method="post" className="w-full">
              <div className="flex flex-col gap-2">
                <OrganizationSelect />
                <Button
                  className="max-w-full"
                  width="full"
                  type="submit"
                  disabled={disabled}
                >
                  Confirm
                </Button>
                <Button
                  variant="secondary"
                  className="max-w-full"
                  width="full"
                  to={"/"}
                  type="button"
                  disabled={disabled}
                >
                  Cancel
                </Button>
              </div>
            </Form>
          </div>
        </div>
      </div>
    </>
  );
}
