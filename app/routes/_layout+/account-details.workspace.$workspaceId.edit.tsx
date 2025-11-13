import { Currency, OrganizationRoles, OrganizationType } from "@prisma/client";
import { parseFormData } from "@remix-run/form-data-parser";
import { useAtomValue } from "jotai";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data , useLoaderData } from "react-router";
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
import { resolveShowShelfBranding } from "~/utils/branding";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  assertIsPost,
  payload,
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

    const [admins, tierLimit, user] = await Promise.all([
      getOrganizationAdmins({
        organizationId: organization.id,
      }),
      getOrganizationTierLimit({
        organizationId: organization.id,
        organizations,
      }),
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tierId: true },
      }),
    ]);

    const canHideBranding = canHideShelfBranding(tierLimit);

    // Team tier users can only hide branding on team workspaces
    // Plus tier users can only hide branding on personal workspaces
    const canHideBrandingForThisWorkspace =
      canHideBranding &&
      (organization.type === OrganizationType.TEAM || user.tierId === "tier_1");

    const header: HeaderData = {
      title: `Edit | ${organization.name}`,
    };

    return payload({
      organization,
      header,
      curriences: Object.keys(Currency),
      isPersonalWorkspace: organization.type === OrganizationType.PERSONAL,
      admins,
      canHideShelfBranding: canHideBrandingForThisWorkspace,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    throw data(error(reason), { status: reason.status });
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

    const [tierLimit, user] = await Promise.all([
      getOrganizationTierLimit({
        organizationId: organization.id,
        organizations,
      }),
      db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tierId: true },
      }),
    ]);

    const canHideBranding = canHideShelfBranding(tierLimit);

    // Team tier users can only hide branding on team workspaces
    // Plus tier users can only hide branding on personal workspaces
    const canHideBrandingForThisWorkspace =
      canHideBranding &&
      (organization.type === OrganizationType.TEAM || user.tierId === "tier_1");

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

        const parsedData = parseData(formData, schema, {
          additionalData: { userId, organizationId: id },
        });

        const { name, currency, qrIdDisplayPreference, showShelfBranding } =
          parsedData;

        let nextShowShelfBranding = resolveShowShelfBranding(
          showShelfBranding,
          organization.showShelfBranding
        );

        if (!canHideBrandingForThisWorkspace) {
          nextShowShelfBranding = true;
        }

        const formDataFile = await parseFormData(request);

        const file = formDataFile.get("image") as File | null;

        // Validate file size
        if (file && file.size > DEFAULT_MAX_IMAGE_UPLOAD_SIZE) {
          throw new ShelfError({
            cause: null,
            message: `Image size exceeds maximum allowed size of ${
              DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024)
            }MB`,
            status: 400,
            label: "Organization",
          });
        }

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

        return payload({ success: true });
      }
      case "permissions": {
        const schema = EditWorkspacePermissionsSettingsFormSchema();

        const parsedData = parseData(formData, schema, {
          additionalData: { userId, organization },
        });

        const {
          selfServiceCanSeeCustody,
          selfServiceCanSeeBookings,
          baseUserCanSeeCustody,
          baseUserCanSeeBookings,
        } = parsedData;

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

        return payload({ success: true });
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

        const parsedData = parseData(formData, schema, {
          additionalData: { userId, organizationId: id },
        });

        const { selfServiceGroupId, adminGroupId, baseUserGroupId } =
          parsedData;

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

        return payload({ success: true });
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
    const reason = makeShelfError(cause, { userId });
    // File size errors are now handled in the validation above
    return data(error(reason), { status: reason.status });
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
