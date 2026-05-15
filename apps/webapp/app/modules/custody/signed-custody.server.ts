import crypto from "node:crypto";
import { AssetStatus, SignedCustodyRequestStatus } from "@prisma/client";
import { db } from "~/database/db.server";
import { sendEmail } from "~/emails/mail.server";
import { signedCustodyRequestTemplateString } from "~/emails/signed-custody-request-template";
import { recordEvent } from "~/modules/activity-event/service.server";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import {
  wrapCustodianForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";

type SignedCustodyRequestEmail = {
  token: string;
  asset: { title: string };
};

type TransactionClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];

export function shouldRequestSignedCustody({
  organization,
  custodianUserEmail,
}: {
  organization: {
    enableSignedCustodyOnAssignment: boolean;
    requireCustodySignatureOnAssignment: boolean;
  };
  custodianUserEmail?: string | null;
}) {
  return (
    organization.enableSignedCustodyOnAssignment &&
    organization.requireCustodySignatureOnAssignment &&
    !!custodianUserEmail
  );
}

export async function createSignedCustodyRequests({
  tx,
  assets,
  organizationId,
  requestedBy,
  teamMember,
}: {
  tx: TransactionClient;
  assets: { id: string; title: string }[];
  organizationId: string;
  requestedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  teamMember: {
    id: string;
    name: string;
    user: {
      id: string;
      firstName: string | null;
      lastName: string | null;
    } | null;
  };
}) {
  const assetIds = assets.map((asset) => asset.id);

  await tx.signedCustodyRequest.updateMany({
    where: {
      assetId: { in: assetIds },
      status: SignedCustodyRequestStatus.PENDING,
    },
    data: { status: SignedCustodyRequestStatus.CANCELLED },
  });

  const actor = wrapUserLinkForNote({
    id: requestedBy.id,
    firstName: requestedBy.firstName,
    lastName: requestedBy.lastName,
  });

  const custodianDisplay = wrapCustodianForNote({ teamMember });

  const requests = await Promise.all(
    assets.map((asset) =>
      tx.signedCustodyRequest.create({
        data: {
          token: crypto.randomBytes(32).toString("hex"),
          organizationId,
          assetId: asset.id,
          teamMemberId: teamMember.id,
          requestedById: requestedBy.id,
        },
        select: {
          id: true,
          token: true,
          asset: { select: { title: true } },
        },
      })
    )
  );

  await tx.note.createMany({
    data: assets.map((asset) => ({
      content: `${actor} requested a signed custody acceptance from ${custodianDisplay}.`,
      type: "UPDATE",
      userId: requestedBy.id,
      assetId: asset.id,
    })),
  });

  return requests;
}

export async function sendSignedCustodyRequestEmails({
  requests,
  recipientEmail,
  recipientName,
  organizationName,
  customEmailFooter,
}: {
  requests: SignedCustodyRequestEmail[];
  recipientEmail: string;
  recipientName: string;
  organizationName: string;
  customEmailFooter?: string | null;
}) {
  for (const request of requests) {
    const signingUrl = `${SERVER_URL}/custody/sign/${request.token}`;
    const html = await signedCustodyRequestTemplateString({
      assetTitle: request.asset.title,
      organizationName,
      recipientEmail,
      recipientName,
      signingUrl,
      customEmailFooter,
    });

    sendEmail({
      to: recipientEmail,
      subject: `Signature required for ${request.asset.title} custody`,
      text: `Howdy ${recipientName},

${organizationName} needs your signature before ${
        request.asset.title
      } can be assigned to your custody.

Review and sign the custody agreement:
${signingUrl}

Thanks,
The Shelf team
${customEmailFooter ? `\n---\n${customEmailFooter}` : ""}`,
      html,
    });
  }
}

export async function completeSignedCustodyRequest({
  token,
  signerUserId,
  signerName,
  signatureDataUrl,
  signerIp,
  signerUserAgent,
}: {
  token: string;
  signerUserId: string;
  signerName: string;
  signatureDataUrl?: string | null;
  signerIp?: string | null;
  signerUserAgent?: string | null;
}) {
  return db.$transaction(async (tx) => {
    const request = await tx.signedCustodyRequest.findUnique({
      where: { token },
      include: {
        asset: { select: { id: true, title: true, status: true } },
        teamMember: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        requestedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!request) {
      throw new ShelfError({
        cause: null,
        title: "Signature request not found",
        message: "This custody signature request could not be found.",
        label: "Custody",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    if (request.teamMember.user?.id !== signerUserId) {
      throw new ShelfError({
        cause: null,
        title: "Action not allowed",
        message:
          "This custody signature request was sent to a different Shelf user.",
        label: "Custody",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    if (request.status === SignedCustodyRequestStatus.SIGNED) {
      return request;
    }

    if (request.status !== SignedCustodyRequestStatus.PENDING) {
      throw new ShelfError({
        cause: null,
        title: "Signature request is no longer active",
        message: "This custody signature request is no longer active.",
        label: "Custody",
        status: 409,
        shouldBeCaptured: false,
      });
    }

    if (request.asset.status !== AssetStatus.AVAILABLE) {
      throw new ShelfError({
        cause: null,
        title: "Asset is no longer available",
        message:
          "This asset is no longer available for custody assignment. Please contact the workspace administrator.",
        label: "Custody",
        status: 409,
        shouldBeCaptured: false,
      });
    }

    await tx.custody.deleteMany({ where: { assetId: request.assetId } });

    await tx.asset.update({
      where: { id: request.assetId, organizationId: request.organizationId },
      data: {
        status: AssetStatus.IN_CUSTODY,
        custody: {
          create: {
            custodian: { connect: { id: request.teamMemberId } },
          },
        },
      },
      select: { id: true },
    });

    const updatedRequest = await tx.signedCustodyRequest.update({
      where: { id: request.id },
      data: {
        status: SignedCustodyRequestStatus.SIGNED,
        signerName,
        signatureDataUrl,
        signerIp,
        signerUserAgent,
        signedAt: new Date(),
      },
      include: {
        asset: { select: { id: true, title: true } },
        teamMember: {
          select: {
            id: true,
            name: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });

    const custodianDisplay = wrapCustodianForNote({
      teamMember: request.teamMember,
    });

    await tx.note.create({
      data: {
        content: `${custodianDisplay} signed the custody agreement and accepted custody.`,
        type: "UPDATE",
        userId: request.requestedById,
        assetId: request.assetId,
      },
    });

    await recordEvent(
      {
        organizationId: request.organizationId,
        actorUserId: request.requestedById,
        action: "CUSTODY_ASSIGNED",
        entityType: "ASSET",
        entityId: request.assetId,
        assetId: request.assetId,
        teamMemberId: request.teamMemberId,
        targetUserId: request.teamMember.user?.id ?? undefined,
      },
      tx
    );

    return updatedRequest;
  });
}
