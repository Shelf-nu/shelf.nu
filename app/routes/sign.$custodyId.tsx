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
import type { HeaderData } from "~/components/layout/header/types";
import { useCrisp } from "~/components/marketing/crisp";

import SignCustodyPage from "~/components/sign/sign-custody-page";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { getAgreementByCustodyId } from "~/modules/custody-agreement";
import { createNote } from "~/modules/note/service.server";
import { custodyAgreementSignedEmailText } from "~/modules/sign/email";
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

    const custodyAgreementFile = await db.custodyAgreementFile
      .findFirstOrThrow({
        where: { custodyAgreementId: custodyAgreement.id },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Custody Agreement file not found",
          status: 404,
          label: "Custody Agreement",
        });
      });

    const header: HeaderData = {
      title: `Sign "${custodyAgreement.name}"`,
    };

    const authSession = context.getOptionalSession();

    return json(
      data({
        header,
        custodyAgreement,
        custodyAgreementFile,
        isAgreementSigned: !!custody.agreementSigned,
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

    let receiptId: string | undefined = undefined;

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

      receiptId = custodyReceipt.id;

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

    if (receiptId) {
      sendEmail({
        to: asset.user.email, // Notify the asset owner
        subject: `Custody Agreement '${custodyAgreement.name}' has been signed`,
        text: custodyAgreementSignedEmailText({
          custodianName: resolveTeamMemberName(custodian),
          agreementName: custodyAgreement.name,
          receiptId,
        }),
      });
    }

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

  return (
    <SignCustodyPage
      custodyAgreement={custodyAgreement}
      custodyAgreementFile={custodyAgreementFile}
      isAgreementSigned={isAgreementSigned}
      isLoggedIn={isLoggedIn}
      overviewButton={{
        label: "To Asset's Overview",
        url: `/assets/${asset.id}/overview`,
      }}
    />
  );
}
