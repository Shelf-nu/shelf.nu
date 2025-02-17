import { useCallback } from "react";
import type { Custody, Template } from "@prisma/client";
import { AssetStatus, Roles } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import { Button } from "~/components/shared/button";
import Agreement from "~/components/sign/agreement";
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

export const loader = async ({ context, request }: LoaderFunctionArgs) => {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { searchParams } = new URL(request.url);

    const { assigneeId, assetId } = parseData(
      searchParams,
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
      include: {
        custody: {
          include: { template: true },
        },
      },
    });

    const custody = asset.custody;
    const template = custody?.template;

    if (!custody || !template) {
      throw new ShelfError({
        cause: null,
        label: "Custody",
        message: "Custody or template does not exists.",
      });
    }

    const templateFile = await db.templateFile.findUnique({
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
      where: { id: userId },
      select: { roles: true },
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

      <div className="order-1 flex size-full flex-col overflow-y-auto overflow-x-clip border-l md:order-2 md:w-[400px]">
        <div className="border-b p-4">
          <img
            src="/static/images/logo-full-color(x2).png"
            alt="logo"
            className="h-8"
          />
        </div>

        <div className="border-b p-4">
          <h1 className="mb-1 text-lg font-semibold">{template.name}</h1>
          <p className="text-gray-600">
            {template.description ?? "No description provided"}
          </p>
        </div>

        <Agreement />
      </div>
    </div>
  );
}
