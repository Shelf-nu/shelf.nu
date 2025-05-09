import { Currency, OrganizationType } from "@prisma/client";
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
import { invariant } from "framer-motion";
import { useAtomValue } from "jotai";
import { z } from "zod";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";

import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";

import {
  EditWorkspaceFormSchema,
  WorkspaceEditForm,
} from "~/components/workspace/edit-form";
import { db } from "~/database/db.server";
import { updateOrganization } from "~/modules/organization/service.server";
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
    await requirePermission({
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

    const header: HeaderData = {
      title: `Edit | ${organization.name}`,
    };

    return json(
      data({
        organization,
        header,
        curriences: Object.keys(Currency),
        isPersonalWorkspace: organization.type === OrganizationType.PERSONAL,
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
  const { workspaceId: id } = getParams(
    params,
    z.object({ workspaceId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    assertIsPost(request);

    await requirePermission({
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

    const { enabledSso } = organization;

    const clonedRequest = request.clone();

    const formData = await clonedRequest.formData();

    const schema = EditWorkspaceFormSchema(
      enabledSso,
      organization.type === "PERSONAL"
    );

    const payload = parseData(formData, schema, {
      additionalData: { userId, id },
    });

    const {
      name,
      currency,
      selfServiceGroupId,
      adminGroupId,
      baseUserGroupId,
    } = payload;

    const formDataFile = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({
        maxPartSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
      })
    );

    const file = formDataFile.get("image") as File | null;
    invariant(file instanceof File, "file not the right type");

    await updateOrganization({
      id,
      name,
      image: file || null,
      userId: authSession.userId,
      currency,
      ...(enabledSso && {
        ssoDetails: {
          selfServiceGroupId: selfServiceGroupId as string, // We can safely assume this is a string because when ssoDetails are enabled, we require the user to provide a value
          adminGroupId: adminGroupId as string,
          baseUserGroupId: baseUserGroupId as string,
        },
      }),
    });

    sendNotification({
      title: "Workspace updated",
      message: "Your workspace  has been updated successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    return json({ success: true });
    // return redirect("/account-details/workspace");
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
      <div className=" items-top flex justify-between">
        <WorkspaceEditForm
          name={organization.name || name}
          currency={organization.currency}
        />
      </div>
    </>
  );
}
