import { Currency, OrganizationRoles, OrganizationType } from "@prisma/client";
import {
  json,
  MaxPartSizeExceededError,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import TransferOwnershipCard from "~/components/settings/transfer-ownership-card";

import {
  EditGeneralWorkspaceSettingsFormSchema,
  EditWorkspacePermissionsSettingsFormSchema,
  EditWorkspaceSSOSettingsFormSchema,
  WorkspaceEditForms,
} from "~/components/workspace/edit-form";
import { db } from "~/database/db.server";
import {
  getOrganizationAdmins,
  updateOrganization,
  updateOrganizationPermissions,
} from "~/modules/organization/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  assertIsPost,
  data,
  error,
  getParams,
  parseData,
} from "~/utils/http.server";

import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canHideShelfBranding } from "~/utils/subscription.server";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { workspaceId: id } = getParams(
    params,
    z.object({ workspaceId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.workspace,
      action: PermissionAction.update,
    });

    /** We get the organization and make sure the current user is the owner as only owner should be able to edit it */
    const organization = await db.organization
      .findUniqueOrThrow({
        where: {
          id,
          owner: {
            is: {
              id: authSession.userId,
            },
          },
        },
        include: {
          ssoDetails: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Your are not the owner of this organization.",
          additionalData: {
            userId,
            id,
          },
          label: "Organization",
          status: 403,
        });
      });

    const admins = await getOrganizationAdmins({
      organizationId: organization.id,
    });

    const tierLimit = await getOrganizationTierLimit({
      organizationId: organization.id,
      organizations,
    });

    const canHideBranding = canHideShelfBranding(tierLimit);

    const header: HeaderData = {
      title: `Edit | ${organization.name}`,
    };

    return json(
      data({
        organization,
        header,
        curriences: Object.keys(Currency),
        isPersonalWorkspace: organization.type === OrganizationType.PERSONAL,
        admins,
        canHideShelfBranding: canHideBranding,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const handle = {
  breadcrumb: () => <span>Edit</span>,
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  /** Get the id of the organization from the params */
  const { workspaceId: id } = getParams(
    params,
    z.object({ workspaceId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    assertIsPost(request);

    const { role, organizations } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.workspace,
      action: PermissionAction.update,
    });

    /** Because you can access this view even when you have a different currentOrganization than the one you are editing
     * We need to query the org using the orgId from the params
     */
    const organization = await db.organization
      .findUniqueOrThrow({
        where: {
          id,
          owner: {
            is: {
              id: authSession.userId,
            },
          },
        },
        include: {
          ssoDetails: true,
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Your are not the owner of this organization.",
          additionalData: {
            userId,
            id,
          },
          label: "Organization",
          status: 403,
        });
      });

    const tierLimit = await getOrganizationTierLimit({
      organizationId: organization.id,
      organizations,
    });

    const canHideBranding = canHideShelfBranding(tierLimit);

    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["general", "permissions", "sso"]),
      }),
      {
        additionalData: {
          organizationId: organization.id,
        },
      }
    );

    switch (intent) {
      case "general": {
        const schema = EditGeneralWorkspaceSettingsFormSchema(
          organization.type === "PERSONAL"
        );

        const payload = parseData(formData, schema, {
          additionalData: { userId, organizationId: id },
        });

        const { name, currency, qrIdDisplayPreference, showShelfBranding } =
          payload;

        let nextShowShelfBranding =
          typeof showShelfBranding === "boolean"
            ? showShelfBranding
            : organization.showShelfBranding;

        if (!canHideBranding) {
          nextShowShelfBranding = true;
        }

        const formDataFile = await unstable_parseMultipartFormData(
          request,
          unstable_createMemoryUploadHandler({
            maxPartSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
          })
        );

        const file = formDataFile.get("image") as File | null;

        await updateOrganization({
          id,
          name,
          image: file || null,
          userId: authSession.userId,
          currency,
          qrIdDisplayPreference,
          showShelfBranding: nextShowShelfBranding,
        });

        sendNotification({
          title: "Workspace updated",
          message: "Your workspace  has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json({ success: true });
      }
      case "permissions": {
        const schema = EditWorkspacePermissionsSettingsFormSchema();

        const payload = parseData(formData, schema, {
          additionalData: { userId, organization },
        });

        const {
          selfServiceCanSeeCustody,
          selfServiceCanSeeBookings,
          baseUserCanSeeCustody,
          baseUserCanSeeBookings,
        } = payload;

        await updateOrganizationPermissions({
          id,
          configuration: {
            selfServiceCanSeeCustody,
            selfServiceCanSeeBookings,
            baseUserCanSeeCustody,
            baseUserCanSeeBookings,
          },
        });

        sendNotification({
          title: "Workspace updated",
          message: "Your workspace  has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json({ success: true });
      }
      case "sso": {
        if (role !== OrganizationRoles.OWNER) {
          throw new ShelfError({
            cause: null,
            title: "Permission denied",
            message: "You are not allowed to edit SSO settings.",
            label: "Settings",
          });
        }

        const { enabledSso } = organization;
        if (!enabledSso) {
          throw new ShelfError({
            cause: null,
            message: "SSO is not enabled for this organization.",
            additionalData: { userId, id },
            label: "Organization",
          });
        }

        const schema = EditWorkspaceSSOSettingsFormSchema(enabledSso);

        const payload = parseData(formData, schema, {
          additionalData: { userId, organizationId: id },
        });

        const { selfServiceGroupId, adminGroupId, baseUserGroupId } = payload;

        await updateOrganization({
          id,
          userId: authSession.userId,
          ssoDetails: {
            selfServiceGroupId: selfServiceGroupId as string,
            adminGroupId: adminGroupId as string,
            baseUserGroupId: baseUserGroupId as string,
          },
        });

        sendNotification({
          title: "Workspace updated",
          message: "Your workspace has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return json({ success: true });
      }
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

export default function WorkspaceEditPage() {
  const name = useAtomValue(dynamicTitleAtom);
  const hasName = name !== "Untitled workspace";
  const { organization } = useLoaderData<typeof loader>();
  return (
    <>
      <Header
        title={hasName ? name : organization.name}
        hideBreadcrumbs
        classNames="-mt-5"
      />
      <div className="items-top flex justify-between">
        <WorkspaceEditForms
          name={organization.name || name}
          currency={organization.currency}
          qrIdDisplayPreference={organization.qrIdDisplayPreference}
          className="mt-4"
        />
      </div>

      <TransferOwnershipCard />
    </>
  );
}
