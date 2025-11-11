import { Currency, OrganizationRoles, OrganizationType } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  data,
  MaxPartSizeExceededError,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "react-router";

import { useLoaderData } from "react-router";
import { z } from "zod";
import { ExportBackupButton } from "~/components/assets/export-backup-button";
import { ErrorContent } from "~/components/errors";

import type { HeaderData } from "~/components/layout/header/types";
import TransferOwnershipCard, {
  TransferOwnershipSchema,
} from "~/components/settings/transfer-ownership-card";

import { Card } from "~/components/shared/card";
import {
  EditGeneralWorkspaceSettingsFormSchema,
  EditWorkspacePermissionsSettingsFormSchema,
  EditWorkspaceSSOSettingsFormSchema,
  WorkspaceEditForms,
} from "~/components/workspace/edit-form";
import { db } from "~/database/db.server";
import {
  getOrganizationAdmins,
  transferOwnership,
  updateOrganization,
  updateOrganizationPermissions,
} from "~/modules/organization/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { resolveShowShelfBranding } from "~/utils/branding";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import {
  canExportAssets,
  canHideShelfBranding,
} from "~/utils/subscription.server";
import { tw } from "~/utils/tw";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, organizations, currentOrganization } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.generalSettings,
        action: PermissionAction.read,
      });

    const [user, tierLimit, admins] = await Promise.all([
      db.user
        .findUniqueOrThrow({
          where: {
            id: userId,
          },
          select: {
            firstName: true,
            tierId: true,
            userOrganizations: {
              include: {
                organization: {
                  include: {
                    ssoDetails: true,
                    _count: {
                      select: {
                        assets: true,
                        members: true,
                        locations: true,
                      },
                    },
                    owner: {
                      select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        profilePicture: true,
                      },
                    },
                  },
                },
              },
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "User not found",
            additionalData: { userId, organizationId },
            label: "Settings",
          });
        }),
      /* Check the tier limit */
      getOrganizationTierLimit({
        organizationId,
        organizations,
      }),
      getOrganizationAdmins({ organizationId }),
    ]);

    const header: HeaderData = {
      title: "General",
    };

    const canHideBranding = canHideShelfBranding(tierLimit);

    // Team tier users can only hide branding on team workspaces
    // Plus tier users can only hide branding on personal workspaces
    const canHideBrandingForThisWorkspace =
      canHideBranding &&
      (currentOrganization.type === OrganizationType.TEAM ||
        user.tierId === "tier_1");

    return payload({
      header,
      organization: currentOrganization,
      canExportAssets: canExportAssets(tierLimit),
      canHideShelfBranding: canHideBrandingForThisWorkspace,
      user,
      curriences: Object.keys(Currency),
      isPersonalWorkspace:
        currentOrganization.type === OrganizationType.PERSONAL,
      admins,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "General",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization, role, organizations } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.generalSettings,
        action: PermissionAction.update,
      });

    const [tierLimit, user] = await Promise.all([
      getOrganizationTierLimit({
        organizationId,
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
      (currentOrganization.type === OrganizationType.TEAM ||
        user.tierId === "tier_1");

    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["general", "permissions", "sso", "transfer-ownership"]),
      }),
      {
        additionalData: {
          organizationId,
        },
      }
    );

    switch (intent) {
      case "general": {
        const schema = EditGeneralWorkspaceSettingsFormSchema(
          currentOrganization.type === "PERSONAL"
        );

        const payload = parseData(formData, schema, {
          additionalData: { userId, organizationId },
        });

        const { name, currency, id, qrIdDisplayPreference, showShelfBranding } =
          payload;

        /** User is allowed to edit his/her current organization only not other organizations. */
        if (currentOrganization.id !== id) {
          throw new ShelfError({
            cause: null,
            message: "You are not allowed to edit this organization.",
            label: "Organization",
          });
        }

        let nextShowShelfBranding = resolveShowShelfBranding(
          showShelfBranding,
          currentOrganization.showShelfBranding
        );

        if (!canHideBrandingForThisWorkspace) {
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

        return redirect("/settings/general");
      }
      case "permissions": {
        const schema = EditWorkspacePermissionsSettingsFormSchema();

        const payload = parseData(formData, schema, {
          additionalData: { userId, organizationId },
        });

        const {
          id,
          selfServiceCanSeeCustody,
          selfServiceCanSeeBookings,
          baseUserCanSeeCustody,
          baseUserCanSeeBookings,
        } = payload;

        /** User is allowed to edit his/her current organization only not other organizations. */
        if (currentOrganization.id !== id) {
          throw new ShelfError({
            cause: null,
            message: "You are not allowed to edit this organization.",
            label: "Organization",
          });
        }

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

        return redirect("/settings/general");
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

        if (!currentOrganization.enabledSso) {
          throw new ShelfError({
            cause: null,
            message: "SSO is not enabled for this organization.",
            label: "Settings",
          });
        }
        const schema = EditWorkspaceSSOSettingsFormSchema(
          currentOrganization.enabledSso
        );

        const payload = parseData(formData, schema, {
          additionalData: { userId, organizationId },
        });

        const { id, selfServiceGroupId, adminGroupId, baseUserGroupId } =
          payload;

        /** User is allowed to edit his/her current organization only not other organizations. */
        if (currentOrganization.id !== id) {
          throw new ShelfError({
            cause: null,
            message: "You are not allowed to edit this organization.",
            label: "Organization",
          });
        }

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

        return redirect("/settings/general");
      }
      case "transfer-ownership": {
        const parsedData = parseData(formData, TransferOwnershipSchema, {
          additionalData: { userId, organizationId },
        });

        const { newOwner } = await transferOwnership({
          currentOrganization,
          newOwnerId: parsedData.newOwner,
          userId: authSession.userId,
        });

        sendNotification({
          title: "Ownership transferred",
          message: `You have successfully transferred ownership of ${currentOrganization.name} to ${newOwner.firstName} ${newOwner.lastName}`,
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return redirect("/assets");
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
    return data(
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
  const { organization, canExportAssets } = useLoaderData<typeof loader>();
  return (
    <div className="mb-2.5 flex flex-col justify-between">
      <WorkspaceEditForms
        name={organization.name}
        currency={organization.currency}
        qrIdDisplayPreference={organization.qrIdDisplayPreference}
      />

      <Card className={tw("mb-0")}>
        <h4 className="text-text-lg font-semibold">Asset backup</h4>
        <p className=" text-sm text-gray-600">
          Download a backup of your assets. If you want to restore a backup,
          please get in touch with support.
        </p>
        <p className=" font-italic mb-2 text-sm text-gray-600">
          IMPORTANT NOTE: QR codes will not be included in the export. Due to
          the nature of how Shelf's QR codes work, they currently cannot be
          exported with assets because they have unique ids. <br />
          Importing a backup will just create a new QR code for each asset.
        </p>
        <ExportBackupButton canExportAssets={canExportAssets} />
      </Card>

      <TransferOwnershipCard />
    </div>
  );
}
