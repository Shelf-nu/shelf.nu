import { useCallback } from "react";
import type { Custody, Template } from "@prisma/client";
import { AssetStatus, Roles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import AgreementPopup, {
  AGREEMENT_POPUP_VISIBLE,
} from "~/components/sign/agreement-popup";

import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { getAsset } from "~/modules/asset/service.server";
import { createNote } from "~/modules/note/service.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ENABLE_PREMIUM_FEATURES } from "~/utils/env";
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
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const loader = async ({
  context,
  request,
  params,
}: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { assigneeId, assetId } = getParams(
      params,
      z.object({
        assigneeId: z.string(),
        assetId: z.string(),
      })
    );

    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.read,
    });

    if (userId !== assigneeId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to sign this asset",
        additionalData: { userId, assetId, assigneeId },
        label: "Assets",
        status: 401,
      });
    }

    const asset = await getAsset({
      id: assetId,
      organizationId,
    });

    // @TODO needs fixing -
    // @ts-ignore
    const custody = asset.custody as Custody;

    // @ts-ignore
    const template = custody.template as Template;

    // Fetch the template PDF associated for the custody
    const templateFile = await db.templateFile.findUniqueOrThrow({
      where: {
        revision_templateId: {
          revision: custody.associatedTemplateVersion!,
          templateId: custody.templateId!,
        },
      },
    });

    if (!template) {
      throw new ShelfError({
        cause: null,
        message: "Template not found",
        status: 404,
        label: "Template",
      });
    }

    const user = await db.user.findUniqueOrThrow({
      where: {
        id: userId,
      },
      select: {
        roles: true,
      },
    });

    return json(
      data({
        user,
        currentOrganizationId: organizationId,
        enablePremium: ENABLE_PREMIUM_FEATURES,
        custody,
        template,
        templateFile,
        isAdmin: user?.roles.some((role) => role.name === Roles["ADMIN"]),
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
};

export async function action({ context, request, params }: ActionFunctionArgs) {
  const method = getActionMethod(request);

  try {
    switch (method) {
      case "POST": {
        const authSession = context.getSession();
        const { userId } = authSession;
        const user = await db.user.findUniqueOrThrow({
          where: {
            id: userId,
          },
          select: {
            firstName: true,
            lastName: true,
          },
        });

        const { assetId } = getParams(
          params,
          z.object({
            assetId: z.string(),
          })
        );

        const { signatureText, signatureImage } = parseData(
          await request.formData(),
          z.object({
            signatureText: z.string(),
            signatureImage: z.string(),
          })
        );

        // Update the custody record
        // @TODO - needs to be caught
        await db.custody.update({
          where: {
            assetId,
          },
          data: {
            signatureImage,
            signatureText,
            templateSigned: true,
          },
        });

        // Update the asset status
        // @TODO - needs to be caught
        await db.asset.update({
          where: {
            id: assetId,
          },
          data: {
            status: AssetStatus.IN_CUSTODY,
          },
        });

        // Send out the notification
        sendNotification({
          title: "Asset signed",
          message: "Your asset has been signed successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        // Create a note
        await createNote({
          content: `${user.firstName} ${user.lastName} signed the asset and now has custody of it`,
          type: "UPDATE",
          userId: userId,
          assetId: assetId,
        });

        return redirect(`/assets/${assetId}`);
      }
    }
    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export default function Sign() {
  const { template } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const showAgreementPopup = useCallback(() => {
    params.set(AGREEMENT_POPUP_VISIBLE, "true");
    setParams(params);
  }, [params, setParams]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <AgreementPopup templateName={template.name} />
      <div className="order-2 grow md:order-1">PDF GOES HERE</div>
      <div className="order-1 flex max-h-[90vh] w-full flex-col overflow-y-auto overflow-x-clip border-l-DEFAULT border-l-gray-200 md:order-2 md:w-[400px]">
        <div className="flex w-full items-center justify-between gap-x-2 border-b-DEFAULT border-b-gray-200 p-4">
          <div title="Home" className="block h-[32px]">
            <img
              src="/images/logo-full-color(x2).png"
              alt="logo"
              className="h-full"
            />
          </div>
          <Button
            onClick={showAgreementPopup}
            className="block md:hidden"
            variant="primary"
          >
            Sign
          </Button>
        </div>
        <div className="flex flex-col gap-y-2 border-b-DEFAULT border-b-gray-200 p-4">
          <h1 className="text-lg font-semibold text-gray-800">
            {template.name}
          </h1>
          <p className="text-gray-600">
            {template.description ?? "No description provided"}
          </p>
        </div>
        {/* @ts-ignore */}
        {/* {window.innerWidth > twConfig.theme.screens.md.split("px")[0] && (
          <Agreement />
        )} */}
      </div>
    </div>
  );
}
