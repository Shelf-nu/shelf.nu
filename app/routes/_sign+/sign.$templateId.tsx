import { AssetStatus } from "@prisma/client";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import Agreement from "~/components/sign/agreement";

import AgreementDialog from "~/components/sign/agreement-dialog";
import { db } from "~/database/db.server";
import { createNote } from "~/modules/note/service.server";
import {
  getTemplateByAssetIdWithCustodian,
  getTemplateById,
} from "~/modules/template";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { sendNotification } from "~/utils/emitter/send-notification.server";
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
import "@react-pdf-viewer/core/lib/styles/index.css";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.read,
    });

    const { searchParams } = new URL(request.url);

    const { assigneeId, assetId } = parseData(
      searchParams,
      z.object({
        assigneeId: z.string(),
        assetId: z.string(),
      })
    );

    if (userId !== assigneeId) {
      throw new ShelfError({
        cause: null,
        message: "You are not authorized to sign this asset",
        additionalData: { userId, assetId, assigneeId },
        label: "Assets",
        status: 401,
      });
    }

    const { custody, template } = await getTemplateByAssetIdWithCustodian({
      assetId,
      organizationId,
    });
    if (custody.templateSigned) {
      throw new ShelfError({
        cause: null,
        message: "Asset custody has already been signed",
        status: 400,
        label: "Assets",
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

    if (!templateFile) {
      throw new ShelfError({
        cause: null,
        message: "Template file not found",
        status: 404,
        label: "Template",
      });
    }

    const header: HeaderData = {
      title: `Sign "${template.name}"`,
    };

    return json(
      data({
        header,
        template,
        templateFile,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export async function action({ context, request, params }: ActionFunctionArgs) {
  const method = getActionMethod(request);
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.template,
      action: PermissionAction.read,
    });

    const { templateId } = getParams(
      params,
      z.object({ templateId: z.string() })
    );

    switch (method) {
      case "POST": {
        const { searchParams } = new URL(request.url);
        const user = await db.user.findUniqueOrThrow({
          where: { id: userId },
          select: {
            firstName: true,
            lastName: true,
          },
        });

        const { assetId } = parseData(
          searchParams,
          z.object({ assetId: z.string() })
        );

        const { signatureText, signatureImage } = parseData(
          await request.formData(),
          z.object({
            signatureText: z.string(),
            signatureImage: z.string(),
          })
        );

        const template = await getTemplateById(templateId);

        await db.$transaction(async (tx) => {
          await tx.custody.update({
            where: { assetId },
            data: {
              signatureImage,
              signatureText,
              templateSigned: true,
            },
          });

          await tx.asset.update({
            where: { id: assetId, organizationId },
            data: { status: AssetStatus.IN_CUSTODY },
          });
        });

        sendNotification({
          title: "Asset signed",
          message: "Your asset has been signed successfully",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        await createNote({
          content: `**${user.firstName} ${user.lastName}** has signed [${template.name}](/assets/${assetId}/activity/view-receipt)`,
          type: "UPDATE",
          userId: userId,
          assetId: assetId,
        });

        return redirect(`/assets/${assetId}/overview`);
      }
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export default function Sign() {
  const { template, templateFile } = useLoaderData<typeof loader>();

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="order-2 grow overflow-y-auto md:order-1">
        <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.4.120/build/pdf.worker.min.js">
          <Viewer fileUrl={templateFile?.url ?? ""} />
        </Worker>
      </div>

      <div className="order-1 flex size-full flex-col overflow-y-auto overflow-x-clip border-l scrollbar-thin md:order-2 md:w-[400px]">
        <div className="flex items-center justify-between border-b p-4">
          <img
            src="/static/images/logo-full-color(x2).png"
            alt="logo"
            className="h-8"
          />

          <AgreementDialog className="md:hidden" />
        </div>

        <div className="border-b p-4">
          <h1 className="mb-1 text-lg font-semibold">{template.name}</h1>
          <p className="text-gray-600">
            {template.description ?? "No description provided"}
          </p>
        </div>

        <Agreement className="hidden md:block" />
      </div>
    </div>
  );
}
