import { useState } from "react";
import { OrganizationType } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useFetcher, useLoaderData } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Spinner } from "~/components/shared/spinner";
import { db } from "~/database/db.server";
import { useDisabled } from "~/hooks/use-disabled";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const SignedCustodySettingsSchema = z.object({
  intent: z.literal("updateSignedCustodySettings"),
  enableSignedCustodyOnAssignment: z
    .string()
    .transform((value) => value === "on")
    .default("false"),
  requireCustodySignatureOnAssignment: z
    .string()
    .transform((value) => value === "on")
    .default("false"),
});

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.generalSettings,
      action: PermissionAction.read,
    });

    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "Signed custody settings are not available in a personal workspace.",
        label: "Settings",
        shouldBeCaptured: false,
      });
    }

    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        enableSignedCustodyOnAssignment: true,
        requireCustodySignatureOnAssignment: true,
      },
    });

    return payload({
      header: { title: "Signed custody settings" },
      organization,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.generalSettings,
      action: PermissionAction.update,
    });

    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "Signed custody settings are not available in a personal workspace.",
        label: "Settings",
        shouldBeCaptured: false,
      });
    }

    const formData = await request.formData();
    const {
      enableSignedCustodyOnAssignment,
      requireCustodySignatureOnAssignment,
    } = parseData(formData, SignedCustodySettingsSchema, {
      additionalData: {
        organizationId,
        formData: Object.fromEntries(formData),
      },
    });

    const resolvedRequireSignature = enableSignedCustodyOnAssignment
      ? requireCustodySignatureOnAssignment
      : false;

    const organization = await db.organization.update({
      where: { id: organizationId },
      data: {
        enableSignedCustodyOnAssignment,
        requireCustodySignatureOnAssignment: resolvedRequireSignature,
      },
      select: {
        id: true,
        enableSignedCustodyOnAssignment: true,
        requireCustodySignatureOnAssignment: true,
      },
    });

    sendNotification({
      title: "Settings updated",
      message: "Signed custody settings have been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return data(payload({ success: true, organization }), { status: 200 });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "Signed custody",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

export default function SignedCustodySettingsPage() {
  const { organization } = useLoaderData<typeof loader>();
  const fetcher = useFetcher({ key: "signed-custody-settings" });
  const disabled = useDisabled(fetcher);
  const zo = useZorm("SignedCustodySettings", SignedCustodySettingsSchema);

  const [signedCustodyEnabled, setSignedCustodyEnabled] = useState(
    organization.enableSignedCustodyOnAssignment
  );

  return (
    <fetcher.Form ref={zo.ref} method="post" className="flex flex-col gap-2">
      <Card className="my-0">
        <div className="mb-6">
          <h3 className="text-text-lg font-semibold">Signed custody</h3>
          <p className="text-sm text-gray-600">
            Configure whether custodians should review and sign an agreement
            when you assign long-term custody.
          </p>
        </div>

        <FormRow
          rowLabel="Enable signed custody"
          subHeading={
            <p>
              Allow administrators to require agreement acknowledgement when
              assigning custody.
            </p>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              id="enableSignedCustodyOnAssignment"
              name={zo.fields.enableSignedCustodyOnAssignment()}
              checked={signedCustodyEnabled}
              disabled={disabled}
              onCheckedChange={setSignedCustodyEnabled}
            />
            <label
              htmlFor="enableSignedCustodyOnAssignment"
              className="hidden text-gray-500"
            >
              Allow
            </label>
          </div>
        </FormRow>

        <FormRow
          rowLabel="Require signature"
          subHeading={
            <p>
              When enabled, custodians must provide a signature before custody
              assignment can be finalized.
            </p>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              id="requireCustodySignatureOnAssignment"
              name={zo.fields.requireCustodySignatureOnAssignment()}
              defaultChecked={organization.requireCustodySignatureOnAssignment}
              disabled={disabled || !signedCustodyEnabled}
            />
            <label
              htmlFor="requireCustodySignatureOnAssignment"
              className="hidden text-gray-500"
            >
              Require signature
            </label>
          </div>
        </FormRow>

        <div className="text-right">
          <Button
            type="submit"
            value="updateSignedCustodySettings"
            name="intent"
            disabled={disabled}
          >
            {disabled ? <Spinner /> : "Save settings"}
          </Button>
        </div>
      </Card>
    </fetcher.Form>
  );
}
