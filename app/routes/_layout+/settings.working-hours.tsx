import { OrganizationType, WorkingHours } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, MaxPartSizeExceededError } from "@remix-run/node";

import { useFetcher, useLoaderData } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import { ErrorContent } from "~/components/errors";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";

import type { HeaderData } from "~/components/layout/header/types";

import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";
import {
  getWorkingHoursForOrganization,
  toggleWorkingHours,
} from "~/modules/working-hours/service.server";
import { WorkingHoursToggleSchema } from "~/modules/working-hours/zod-utils";

import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.workingHours,
      action: PermissionAction.read,
    });

    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You are not allowed to access working hours in a personal workspace.",
        label: "Settings",
      });
    }

    const workingHours = await getWorkingHoursForOrganization(organizationId);

    const header: HeaderData = {
      title: "Working hours",
      subHeading:
        "Manage your workspace's working hours. This will allow you to limit when bookings' start and end times and dates.",
    };

    return json(
      data({
        header,
        organization: currentOrganization,
        workingHours,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "Working hours",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.workingHours,
      action: PermissionAction.update,
    });
    const formData = await request.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["toggle", "update"]),
      }),
      {
        additionalData: {
          organizationId,
        },
      }
    );

    switch (intent) {
      case "toggle": {
        const { enableWorkingHours } = parseData(
          formData,
          WorkingHoursToggleSchema
        );

        await toggleWorkingHours({
          organizationId,
          enabled: enableWorkingHours,
        });

        sendNotification({
          title: "Workspace updated",
          message: "Your workspace  has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json(data({ success: true }), { status: 200 });
      }
      // case "permissions": {
      //   const schema = EditWorkspacePermissionsSettingsFormSchema();

      //   const payload = parseData(formData, schema, {
      //     additionalData: { userId, organizationId },
      //   });

      //   const {
      //     id,
      //     selfServiceCanSeeCustody,
      //     selfServiceCanSeeBookings,
      //     baseUserCanSeeCustody,
      //     baseUserCanSeeBookings,
      //   } = payload;

      //   /** User is allowed to edit his/her current organization only not other organizations. */
      //   if (currentOrganization.id !== id) {
      //     throw new ShelfError({
      //       cause: null,
      //       message: "You are not allowed to edit this organization.",
      //       label: "Organization",
      //     });
      //   }

      //   await updateOrganizationPermissions({
      //     id,
      //     configuration: {
      //       selfServiceCanSeeCustody,
      //       selfServiceCanSeeBookings,
      //       baseUserCanSeeCustody,
      //       baseUserCanSeeBookings,
      //     },
      //   });

      //   sendNotification({
      //     title: "Workspace updated",
      //     message: "Your workspace  has been updated successfully",
      //     icon: { name: "success", variant: "success" },
      //     senderId: authSession.userId,
      //   });

      //   return redirect("/settings/general");
      // }
      // case "sso": {
      //   if (!currentOrganization.enabledSso) {
      //     throw new ShelfError({
      //       cause: null,
      //       message: "SSO is not enabled for this organization.",
      //       label: "Settings",
      //     });
      //   }
      //   const schema = EditWorkspaceSSOSettingsFormSchema(
      //     currentOrganization.enabledSso
      //   );

      //   const payload = parseData(formData, schema, {
      //     additionalData: { userId, organizationId },
      //   });

      //   const { id, selfServiceGroupId, adminGroupId, baseUserGroupId } =
      //     payload;

      //   /** User is allowed to edit his/her current organization only not other organizations. */
      //   if (currentOrganization.id !== id) {
      //     throw new ShelfError({
      //       cause: null,
      //       message: "You are not allowed to edit this organization.",
      //       label: "Organization",
      //     });
      //   }

      //   await updateOrganization({
      //     id,
      //     userId: authSession.userId,
      //     ssoDetails: {
      //       selfServiceGroupId: selfServiceGroupId as string,
      //       adminGroupId: adminGroupId as string,
      //       baseUserGroupId: baseUserGroupId as string,
      //     },
      //   });

      //   sendNotification({
      //     title: "Workspace updated",
      //     message: "Your workspace has been updated successfully",
      //     icon: { name: "success", variant: "success" },
      //     senderId: authSession.userId,
      //   });

      //   return redirect("/settings/general");
      // }
      default: {
        throw new ShelfError({
          cause: null,
          message: "Invalid action",
          additionalData: { intent },
          label: "Team",
        });
      }
    }
  } catch (cause) {
    const isMaxPartSizeExceeded = cause instanceof MaxPartSizeExceededError;
    const reason = makeShelfError(cause, { userId });
    return json(
      error({
        ...reason,
        ...(isMaxPartSizeExceeded && {
          title: "File too large",
          message: "Max file size is 4MB.",
        }),
      }),
      { status: reason.status }
    );
  }
}

export default function GeneralPage() {
  const { header } = useLoaderData<typeof loader>();
  const { workingHours } = useLoaderData<typeof loader>();
  return (
    <Card className={tw("my-0")}>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        <EnableWorkingHoursForm enabled={workingHours.enabled} />
      </div>
      {/* <input type="hidden" value={organization.id} name="id" /> */}

      {/* <FormRow
          rowLabel={"Name"}
          className="border-b-0 pb-[10px] pt-0"
          required={zodFieldIsRequired(schema.shape.name)}
        >
          <Input
            label="Name"
            hideLabel
            name={zo.fields.name()}
            disabled={isPersonalWorkspace || disabled}
            error={zo.errors.name()?.message}
            autoFocus
            onChange={updateTitle}
            className="w-full"
            defaultValue={name || undefined}
            placeholder=""
            required={!isPersonalWorkspace}
          />
        </FormRow>

        <FormRow rowLabel={"Main image"} className="border-b-0">
          <div>
            <p className="hidden lg:block">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
            <Input
              // disabled={disabled}
              accept={ACCEPT_SUPPORTED_IMAGES}
              name="image"
              type="file"
              onChange={validateFile}
              label={"Main image"}
              hideLabel
              error={fileError}
              className="mt-2"
              inputClassName="border-0 shadow-none p-0 rounded-none"
            />
            <p className="mt-2 lg:hidden">
              Accepts PNG, JPG or JPEG (max.4 MB)
            </p>
          </div>
        </FormRow>

        <div>
          <FormRow
            rowLabel={"Currency"}
            className={"border-b-0"}
            subHeading={
              <p>
                Choose the currency for your workspace. If you don't see your
                currency, please{" "}
                <CrispButton variant="link" className="inline text-xs">
                  contact support
                </CrispButton>
                .
              </p>
            }
          >
            <InnerLabel hideLg>Currency</InnerLabel>
            <CurrencySelector
              defaultValue={currency || "USD"}
              name={zo.fields.currency()}
            />
          </FormRow>
        </div>
        <div className="text-right">
          <Button
            type="submit"
            disabled={disabled}
            value="general"
            name="intent"
          >
            {disabled ? <Spinner /> : "Save"}
          </Button>
        </div> */}
    </Card>
    // </fetcher.Form>
  );
}

function EnableWorkingHoursForm({ enabled }: { enabled: boolean }) {
  const disabled = useDisabled();
  const fetcher = useFetcher();
  const zo = useZorm("EnableWorkingHoursForm", WorkingHoursToggleSchema);
  return (
    <div>
      <fetcher.Form
        ref={zo.ref}
        method="post"
        onChange={(e) => fetcher.submit(e.currentTarget)}
      >
        <FormRow
          rowLabel={`Enable working hours`}
          subHeading={
            <div>Working hours will be enabled for your workspace.</div>
          }
          className="border-b-0 pb-[10px]"
          required
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={zo.fields.enableWorkingHours()}
              disabled={disabled} // Disable for self service users
              defaultChecked={enabled}
              required
              title={"Toggle working hours"}
            />
            <label
              htmlFor={`enableWorkingHours-${zo.fields.enableWorkingHours()}`}
              className=" hidden text-gray-500"
            >
              Enable working hours
            </label>
          </div>
          <input type="hidden" value="toggle" name="intent" />
        </FormRow>
      </fetcher.Form>
    </div>
  );
}
