import {
  AssetStatus,
  CustodySignatureStatus,
  CustodyStatus,
  KitStatus,
  OrganizationRoles,
} from "@prisma/client";
import { json } from "@remix-run/node";
import type {
  ActionFunctionArgs,
  MetaFunction,
  LoaderFunctionArgs,
} from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { z } from "zod";
import type { HeaderData } from "~/components/layout/header/types";
import SignCustodyPage from "~/components/sign/sign-custody-page";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { getAgreementByKitCustodyId } from "~/modules/kit/service.server";
import { custodyAgreementSignedEmailText } from "~/modules/sign/email";
import { getUserByID } from "~/modules/user/service.server";
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

export async function loader({ context, params, request }: LoaderFunctionArgs) {
  const { custodyId } = getParams(params, z.object({ custodyId: z.string() }));

  try {
    const authSession = context.getOptionalSession();

    const { custodian, custody, custodyAgreement, kit } =
      await getAgreementByKitCustodyId({ custodyId });

    let isBaseOrSelfService = false;

    /**
     * If there is a user associated with the custodian then make sure
     * the right authenticated user is signing the custody.
     */
    if (custodian.user) {
      if (!authSession?.userId) {
        throw new ShelfError({
          cause: null,
          label: "Custody Agreement",
          title: "Not allowed",
          message:
            "This custody agreement requires you to be logged in to sign it.",
          additionalData: { showLogin: true },
        });
      }

      const { organizationId } = await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.custodyAgreement,
        action: PermissionAction.read,
      });

      const user = await getUserByID(authSession.userId, {
        userOrganizations: true,
      });

      const roles = user?.userOrganizations.find(
        (userOrg) => userOrg.organizationId === organizationId
      )?.roles;

      const isSelfService =
        roles?.includes(OrganizationRoles.SELF_SERVICE) || false;
      const isBase = roles?.includes(OrganizationRoles.BASE) || false;

      isBaseOrSelfService = isSelfService || isBase;

      if (authSession.userId !== custodian.user.id) {
        throw new ShelfError({
          cause: null,
          title: "Not allowed",
          message: "You are not allowed to sign this kit's custody.",
          label: "Kit",
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
          label: "Custody Agreement",
          status: 404,
          message: "Custody Agreement file not found.",
        });
      });

    const header: HeaderData = {
      title: `Sign "${custodyAgreement.name}"`,
    };

    return json(
      data({
        header,
        custodyAgreement,
        custodyAgreementFile,
        isAgreementSigned: !!custody.agreementSigned,
        isLoggedIn: !!authSession,
        kit,
        isBaseOrSelfService,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause);
    throw json(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header?.title) },
];

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getOptionalSession();
  const { custodyId } = getParams(params, z.object({ custodyId: z.string() }));

  try {
    assertIsPost(request);

    const { custodian, custody, custodyAgreement, kit } =
      await getAgreementByKitCustodyId({ custodyId });

    if (!custodyAgreement.signatureRequired) {
      throw new ShelfError({
        cause: null,
        label: "Custody Agreement",
        message: "This custody agreement does not require a signature.",
      });
    }

    if (custody.agreementSigned) {
      throw new ShelfError({
        cause: null,
        label: "Kit",
        status: 400,
        message: "Kit custody has already been signed.",
      });
    }

    /**
     * If there is a user associated with the custodian then make sure
     * that the right user is signing the custody.
     */
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
          label: "Kit",
          title: "Not allowed",
          message: "You are not authorized to sign this custody.",
          status: 401,
        });
      }
    }

    const { signatureText, signatureImage } = parseData(
      await request.formData(),
      z.object({ signatureText: z.string(), signatureImage: z.string() })
    );

    const assetIds = kit.assets.map((a) => a.id);

    let receiptId: string | undefined = undefined;

    await db.$transaction(async (tx) => {
      /** Update sign info in kit's custody */
      await tx.kitCustody.update({
        where: { id: custody.id },
        data: {
          signatureImage,
          signatureText,
          agreementSigned: true,
          agreementSignedOn: new Date(),
          signatureStatus: CustodySignatureStatus.SIGNED,
        },
      });

      /** Update kit's status */
      await db.kit.update({
        where: { id: kit.id },
        data: { status: KitStatus.IN_CUSTODY },
      });

      /** Update status of all assets inside the kit */
      await db.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** Update the sign status of all custodies of assets */
      await db.custody.updateMany({
        where: { assetId: { in: assetIds } },
        data: { signatureStatus: CustodySignatureStatus.SIGNED },
      });

      /** Update custody receipt */
      const custodyReceipt = await tx.custodyReceipt.findFirst({
        where: { kitId: kit.id, custodyStatus: CustodyStatus.ACTIVE },
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
        title: "Kit custody signed",
        message: "Your kit has been signed successfully",
        icon: { name: "success", variant: "success" },
        senderId: authSession.userId,
      });
    }

    if (receiptId) {
      sendEmail({
        to: kit.createdBy.email, // Notify the owner
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

export default function SignKitCustody() {
  const {
    custodyAgreement,
    custodyAgreementFile,
    isAgreementSigned,
    isLoggedIn,
    kit,
    isBaseOrSelfService,
  } = useLoaderData<typeof loader>();

  return (
    <SignCustodyPage
      custodyAgreement={custodyAgreement}
      custodyAgreementFile={custodyAgreementFile}
      isAgreementSigned={isAgreementSigned}
      isLoggedIn={isLoggedIn}
      overviewButton={{
        label: "To Kit's Page",
        url: `/kits/${kit.id}`,
      }}
      isBaseOrSelfService={isBaseOrSelfService}
    />
  );
}
