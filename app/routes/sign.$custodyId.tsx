import {
  AssetStatus,
  CustodySignatureStatus,
  CustodyStatus,
} from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import Icon from "~/components/icons/icon";
import type { HeaderData } from "~/components/layout/header/types";
import { useCrisp } from "~/components/marketing/crisp";
import PdfViewer from "~/components/pdf-viewer/pdf-viewer";
import { Button } from "~/components/shared/button";
import Agreement from "~/components/sign/agreement";

import AgreementDialog from "~/components/sign/agreement-dialog";
import When from "~/components/when/when";
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
          additionalData: { showLogin: true },
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

    const custodyAgreementFile = await db.custodyAgreementFile.findFirst({
      where: { custodyAgreementId: custodyAgreement.id },
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

    const authSession = context.getOptionalSession();

    return json(
      data({
        header,
        custodyAgreement,
        custodyAgreementFile,
        isAgreementSigned: custody.agreementSigned,
        isLoggedIn: !!authSession,
        asset: custody.asset,
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

    if (!custodyAgreement.signatureRequired) {
      throw new ShelfError({
        cause: null,
        message: "This custody agreement does not require a signature.",
        label: "Custody Agreement",
      });
    }

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

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export default function Sign() {
  useCrisp();
  const {
    custodyAgreement,
    custodyAgreementFile,
    isAgreementSigned,
    isLoggedIn,
    asset,
  } = useLoaderData<typeof loader>();

  if (isAgreementSigned) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex w-[450px] flex-col items-center justify-center gap-4 p-6 text-center">
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

          <When
            truthy={isLoggedIn}
            fallback={
              <Button className="w-full" to="/login">
                Login now
              </Button>
            }
          >
            <div className="flex w-full flex-col items-center gap-4 md:flex-row">
              <Button className="w-full" variant="secondary" to="/dashboard">
                To Dashboard
              </Button>

              <Button
                className="w-full break-keep"
                to={`/assets/${asset.id}/overview`}
              >
                To Asset's Overview
              </Button>
            </div>
          </When>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-[url('/static/images/bg-overlay1.png')] p-4 md:p-14">
      <div className="size-full border bg-gray-25">
        <div className="flex h-full flex-col md:flex-row">
          <div className="relative order-2 flex h-full grow overflow-y-auto md:order-1">
            <PdfViewer url={custodyAgreementFile.url} />
          </div>

          <div className="order-1 flex size-full flex-col overflow-y-auto overflow-x-clip border-l scrollbar-thin md:order-2 md:w-[400px]">
            <div className="flex items-center justify-between border-b p-4">
              <img
                src="/static/images/logo-full-color(x2).png"
                alt="logo"
                className="h-8"
              />

              <When truthy={custodyAgreement.signatureRequired}>
                <AgreementDialog className="md:hidden" />
              </When>
            </div>

            <div className="border-b p-4">
              <h1 className="mb-1 text-lg font-semibold">
                {custodyAgreement.name}
              </h1>
              <p className="text-gray-600">
                {custodyAgreement.description ?? "No description provided"}
              </p>
            </div>

            <When truthy={custodyAgreement.signatureRequired}>
              <Agreement className="hidden md:block" />
            </When>
          </div>
        </div>
      </div>
    </div>
  );
}
