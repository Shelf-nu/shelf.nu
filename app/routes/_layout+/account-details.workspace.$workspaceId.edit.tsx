import { Currency } from "@prisma/client";
import {
  json,
  redirect,
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
  NewWorkspaceFormSchema,
  WorkspaceForm,
} from "~/components/workspace/form";

import { db } from "~/database/db.server";
import { updateOrganization } from "~/modules/organization/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
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
} from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";
import { MAX_SIZE } from "./account-details.workspace.new";

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

    const clonedRequest = request.clone();

    const formData = await clonedRequest.formData();
    const payload = parseData(formData, NewWorkspaceFormSchema, {
      additionalData: { userId, id },
    });

    const { name, currency } = payload;

    const formDataFile = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: MAX_SIZE })
    );

    const file = formDataFile.get("image") as File | null;
    invariant(file instanceof File, "file not the right type");

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

    return redirect("/account-details/workspace");
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, id });
    return json(error(reason), { status: reason.status });
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
        <WorkspaceForm
          name={organization.name || name}
          currency={organization.currency}
        />
      </div>
    </>
  );
}
