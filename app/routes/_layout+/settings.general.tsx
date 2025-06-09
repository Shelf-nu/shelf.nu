import { Currency, OrganizationRoles, OrganizationType } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import {
  json,
  MaxPartSizeExceededError,
  redirect,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";

import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { ExportBackupButton } from "~/components/assets/export-backup-button";
import { ErrorContent } from "~/components/errors";

import type { HeaderData } from "~/components/layout/header/types";

import { Card } from "~/components/shared/card";
import {
  EditGeneralWorkspaceSettingsFormSchema,
  EditWorkspacePermissionsSettingsFormSchema,
  EditWorkspaceSSOSettingsFormSchema,
  WorkspaceEditForms,
} from "~/components/workspace/edit-form";
import { db } from "~/database/db.server";
import {
  updateOrganization,
  updateOrganizationPermissions,
} from "~/modules/organization/service.server";
import { getOrganizationTierLimit } from "~/modules/tier/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { canExportAssets } from "~/utils/subscription.server";
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

    const user = await db.user
      .findUniqueOrThrow({
        where: {
          id: userId,
        },
        select: {
          firstName: true,

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
      });

    /* Check the tier limit */
    const tierLimit = await getOrganizationTierLimit({
      organizationId,
      organizations,
    });

    const header: HeaderData = {
      title: "General",
    };

    return json(
      data({
        header,
        organization: currentOrganization,
        canExportAssets: canExportAssets(tierLimit),
        user,
        curriences: Object.keys(Currency),
        isPersonalWorkspace:
          currentOrganization.type === OrganizationType.PERSONAL,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
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
    const { organizationId, currentOrganization, role } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.generalSettings,
        action: PermissionAction.update,
      });
    const clonedRequest = request.clone();
    const formData = await clonedRequest.formData();

    const { intent } = parseData(
      formData,
      z.object({
        intent: z.enum(["general", "permissions", "sso"]),
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

        const { name, currency, id } = payload;

        /** User is allowed to edit his/her current organization only not other organizations. */
        if (currentOrganization.id !== id) {
          throw new ShelfError({
            cause: null,
            message: "You are not allowed to edit this organization.",
            label: "Organization",
          });
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
  const { organization, canExportAssets } = useLoaderData<typeof loader>();
  return (
    <div className="mb-2.5 flex flex-col justify-between">
      <WorkspaceEditForms
        name={organization.name}
        currency={organization.currency}
      />
      <Card className={tw("")}>
        <div className=" mb-6">
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
        </div>
      </Card>
    </div>
  );
}
