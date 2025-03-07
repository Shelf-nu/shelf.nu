import {
  AssetStatus,
  CustodySignatureStatus,
  CustodyStatus,
} from "@prisma/client";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import * as pdfjs from "pdfjs-dist";
import { z } from "zod";
import Icon from "~/components/icons/icon";
import type { HeaderData } from "~/components/layout/header/types";
import { useCrisp } from "~/components/marketing/crisp";
import { Button } from "~/components/shared/button";
import Agreement from "~/components/sign/agreement";

import AgreementDialog from "~/components/sign/agreement-dialog";
import { db } from "~/database/db.server";
import { getAgreementByCustodyId } from "~/modules/custody-agreement";
import { createNote } from "~/modules/note/service.server";
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
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import "@react-pdf-viewer/core/lib/styles/index.css";
import { resolveTeamMemberName } from "~/utils/user";

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { custodyId } = getParams(params, z.object({ custodyId: z.string() }));

  try {
    const { custodian, custody, custodyAgreement } =
      await getAgreementByCustodyId({ custodyId });

    /** If there is a user associated with the custodian then make sure that right user is signing the custody. */
    if (custodian.user) {
      const authSession = context.getOptionalSession();
      if (!authSession?.userId) {
        throw new ShelfError({
          cause: null,
          label: "Custody Agreement",
          message:
            "This custody agreement requires you to be logged in to sign it.",
          title: "Not allowed",
        });
      }

      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.custodyAgreement,
        action: PermissionAction.read,
      });

      if (authSession.userId !== custodian.user.id) {
        throw new ShelfError({
          cause: null,
          title: "Not allowed",
          message: "You are not allowed to sign this asset.",
          additionalData: { userId: authSession.userId },
          label: "Assets",
          status: 401,
        });
      }
    }

    const custodyAgreementFile = await db.custodyAgreementFile.findUnique({
      where: {
        revision_custodyAgreementId: {
          revision: custody.associatedAgreementVersion!,
          custodyAgreementId: custody.agreementId!,
        },
      },
    });

    if (!custodyAgreementFile) {
      throw new ShelfError({
        cause: null,
        message: "Custody Agreement file not found",
        status: 404,
        label: "Custody Agreement",
      });
    }

    const header: HeaderData = {
      title: `Sign "${custodyAgreement.name}"`,
    };

    return json(
      data({
        header,
        custodyAgreement,
        custodyAgreementFile,
        isAgreementSigned: custody.agreementSigned,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getOptionalSession();

  const { custodyId } = getParams(params, z.object({ custodyId: z.string() }));

  try {
    assertIsPost(request);

    const { custodian, custody, custodyAgreement, asset } =
      await getAgreementByCustodyId({ custodyId });

    if (custody.agreementSigned) {
      throw new ShelfError({
        cause: null,
        message: "Asset custody has already been signed",
        status: 400,
        label: "Assets",
      });
    }

    /** If there is a user associated with the custodian then make sure that right user is signing the custody. */
    if (custodian.user) {
      if (!authSession?.userId) {
        throw new ShelfError({
          cause: null,
          label: "Custody Agreement",
          message: "You must be authenticated to sign this custody.",
        });
      }

      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.custodyAgreement,
        action: PermissionAction.read,
      });

      if (authSession.userId !== custodian.user.id) {
        throw new ShelfError({
          cause: null,
          message: "You are not authorized to sign this custody",
          additionalData: { userId: authSession.userId },
          label: "Assets",
          status: 401,
        });
      }
    }

    const { signatureText, signatureImage } = parseData(
      await request.formData(),
      z.object({
        signatureText: z.string(),
        signatureImage: z.string(),
      })
    );

    await db.$transaction(async (tx) => {
      await tx.custody.update({
        where: { id: custody.id },
        data: {
          signatureImage,
          signatureText,
          agreementSigned: true,
          agreementSignedOn: new Date(),
          signatureStatus: CustodySignatureStatus.SIGNED,
        },
      });

      await tx.asset.update({
        where: { id: custody.asset.id },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** At this point, we must have a CustodyReceipt for the custody, if not then it is a bug in our system */
      const custodyReceipt = await tx.custodyReceipt.findFirst({
        where: { assetId: asset.id, custodyStatus: CustodyStatus.ACTIVE },
        select: { id: true },
      });
      if (!custodyReceipt) {
        throw new ShelfError({
          cause: null,
          label: "Custody Agreement",
          message: "Could not find custody receipt, please contact support.",
        });
      }

      await tx.custodyReceipt.update({
        where: { id: custodyReceipt.id },
        data: {
          custodyStatus: CustodyStatus.ACTIVE,
          signatureStatus: CustodySignatureStatus.SIGNED,
          signatureImage,
          signatureText,
          agreementSigned: true,
          agreementSignedOn: new Date(),
        },
      });
    });

    if (authSession?.userId) {
      sendNotification({
        title: "Asset signed",
        message: "Your asset has been signed successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
    }

    await createNote({
      content: `**${resolveTeamMemberName(custodian)}** has signed [${
        custodyAgreement.name
      }](/receipts?receiptId=${custody.id})`,
      type: "UPDATE",
      userId: authSession?.userId ?? custodyAgreement.createdById,
      assetId: custody.asset.id,
    });

    return redirect(
      authSession?.userId ? `/assets/${custody.asset.id}/overview` : "/login"
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export default function Sign() {
  useCrisp();
  const { custodyAgreement, custodyAgreementFile, isAgreementSigned } =
    useLoaderData<typeof loader>();

  if (isAgreementSigned) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex w-96 flex-col items-center justify-center gap-4 p-6 text-center">
          <div className="flex items-center justify-center rounded-full bg-green-50 p-1">
            <div className="flex items-center justify-center rounded-full bg-green-100 p-2">
              <Icon icon="sign" className="text-green-600" />
            </div>
          </div>

          <div>
            <h4 className="mb-1">Successfully signed document.</h4>
            <p>
              Thank you for signing the document. You can close this page or
              visit your dashboard.
            </p>
          </div>

          <Button className="w-full" variant="secondary" to="/assets">
            To Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[url('/static/images/bg-overlay1.png')] p-4 md:p-14">
      <div className="size-full border bg-gray-25">
        <div className="flex h-full flex-col md:flex-row">
          <div className="order-2 grow overflow-y-auto md:order-1">
            <Worker
              workerUrl={`https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`}
            >
              <Viewer fileUrl={custodyAgreementFile?.url ?? ""} />
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
              <h1 className="mb-1 text-lg font-semibold">
                {custodyAgreement.name}
              </h1>
              <p className="text-gray-600">
                {custodyAgreement.description ?? "No description provided"}
              </p>
            </div>

            <Agreement className="hidden md:block" />
          </div>
        </div>
      </div>
    </div>
  );
}
