import type { Asset } from "@prisma/client";
import {
  AssetStatus,
  CustodySignatureStatus,
  CustodyStatus,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

export async function releaseCustody({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    /**
     * So, for releasing a custody we have 2 cases to handle now
     * 1. If the custody requires a signature and user have not signed it yet
     * 2. If the custody does not require a signature
     */
    const custody = await db.custody.findUnique({
      where: { assetId },
      select: {
        id: true,
        agreementSigned: true,
        agreement: {
          select: { signatureRequired: true },
        },
      },
    });
    if (!custody) {
      throw new ShelfError({
        cause: null,
        label: "Custody",
        message: "Custody not found",
      });
    }

    const custodyRequireSignButNotSigned =
      custody.agreement &&
      custody.agreement.signatureRequired &&
      !custody.agreementSigned;

    /**
     * In our updated approach, we remove the current custody
     * and update the status of CustodyReceipt accordingly
     */
    return await db.$transaction(async (tx) => {
      /** Remove current custody from asset */
      const asset = await tx.asset.update({
        where: { id: assetId, organizationId },
        data: { status: AssetStatus.AVAILABLE, custody: { delete: true } },
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      });

      const custodyReceipt = await tx.custodyReceipt.findFirst({
        where: { custodyStatus: CustodyStatus.ACTIVE, assetId, organizationId },
        select: { id: true },
      });

      /** Update the status of CustodyReceipt */
      if (custodyReceipt) {
        await db.custodyReceipt.update({
          where: { id: custodyReceipt.id },
          data: {
            custodyStatus: custodyRequireSignButNotSigned
              ? CustodyStatus.CANCELLED
              : CustodyStatus.FINISHED,
            signatureStatus: custodyRequireSignButNotSigned
              ? CustodySignatureStatus.CANCELLED
              : undefined,
          },
        });
      }

      return asset;
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { assetId },
      label: "Custody",
    });
  }
}
