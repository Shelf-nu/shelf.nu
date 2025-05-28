import type {
  Prisma,
  Organization,
  User,
  Asset,
  CustodyAgreement,
  Custody,
} from "@prisma/client";
import { AssetStatus, CustodyAgreementType } from "@prisma/client";
import { v4 } from "uuid";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";
import { assertUserCanActivateMoreAgreements } from "~/utils/subscription.server";
import { resolveTeamMemberName } from "~/utils/user";
import { createNote } from "../note/service.server";

const label = "Custody Agreement";

export async function createCustodyAgreement({
  name,
  description,
  signatureRequired,
  userId,
  organizationId,
  isActive,
}: Pick<
  CustodyAgreement,
  "name" | "description" | "signatureRequired" | "isActive"
> & {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    const sameExistingAgreementCount = await db.custodyAgreement.count({
      where: { type: "CUSTODY", organizationId },
    });

    const data = {
      name,
      type: "CUSTODY",
      description,
      signatureRequired,
      createdBy: { connect: { id: userId } },
      organization: { connect: { id: organizationId } },
      isDefault: sameExistingAgreementCount === 0,
      isActive,
    } satisfies Prisma.CustodyAgreementCreateInput;

    const custody = await db.custodyAgreement.create({ data });
    return custody;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error creating agreement",
      message:
        "Something went wrong while creating the custody agreement. Please try again or contact support.",
      additionalData: { name, description, signatureRequired },
      label,
    });
  }
}

export async function updateCustodyAgreement({
  id,
  name,
  description,
  signatureRequired,
  userId,
  organizationId,
}: Pick<
  CustodyAgreement,
  "id" | "name" | "description" | "signatureRequired" | "organizationId"
> & {
  userId: User["id"];
}) {
  try {
    const data = {
      name,
      description,
      signatureRequired,
    };

    const updatedCustodyAgreement = await db.custodyAgreement.update({
      where: { id, organizationId },
      data,
    });

    /**
     * If the signatureRequired is true, we need to search through all the Custodies that
     * have this agreement associated with it. We will check if the agreementSigned is false.
     *
     * If it is false, this could mean a scenario that the custodian has the asset in custody
     * and wasn't required to sign the agreement. But since we are setting signatureRequired to true,
     * we need to set the asset custody to "SIGNATURE_PENDING" and furthermore, ask the custodian to sign
     * the agreement via mailing them.
     */
    if (signatureRequired) {
      const custodies = await db.custody.findMany({
        where: {
          agreementId: updatedCustodyAgreement.id,
          agreementSigned: false,
        },
        include: {
          custodian: {
            select: {
              id: true,
              name: true,
              user: {
                select: { firstName: true, lastName: true, email: true },
              },
            },
          },
        },
      });

      for (const custody of custodies) {
        // Set the asset status to SIGNATURE_PENDING
        await db.asset.update({
          where: { id: custody.assetId },
          data: { status: AssetStatus.SIGNATURE_PENDING },
        });

        // Send notifications
        await createNote({
          content: `Custody agreement **${
            updatedCustodyAgreement.name
          }** now requires a signature. **${resolveTeamMemberName(
            custody.custodian
          )}** needs to sign the **${
            updateCustodyAgreement.name
          }** agreement before receiving custody.`,
          type: "UPDATE",
          userId,
          assetId: custody.assetId,
        });
      }
    }

    return updatedCustodyAgreement;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error updating agreement",
      message:
        "Something went wrong while updating the custody agreement. Please try again or contact support.",
      additionalData: { id },
      label,
    });
  }
}

export async function updateAgreementFile({
  request,
  pdfName,
  pdfSize,
  custodyAgreementId,
  organizationId,
}: {
  request: Request;
  custodyAgreementId: string;
  pdfName: string;
  pdfSize: number;
  organizationId: User["id"];
}) {
  try {
    const pdfHash = v4();
    const newFileName = `${organizationId}/${custodyAgreementId}/${pdfHash}`;
    const fileData = await parseFileFormData({
      request,
      bucketName: "custody-agreements",
      newFileName,
    });

    const pdf = fileData.get("pdf") as string;

    if (!pdf) {
      return null;
    }

    const canUpdateAgreementFile = await canUserUpdateAgreementFile({
      agreementId: custodyAgreementId,
      organizationId,
    });
    if (!canUpdateAgreementFile) {
      throw new ShelfError({
        cause: null,
        label,
        message:
          "You cannot update agreement file because a custody with this agreement already exists.",
      });
    }

    const custodyAgreement = await db.custodyAgreement.findUniqueOrThrow({
      where: { id: custodyAgreementId, organizationId },
      select: { id: true, custodyAgreementFiles: { select: { id: true } } },
    });

    const agreementFile = custodyAgreement.custodyAgreementFiles[0];

    const publicUrl = await getPublicFileURL({
      bucketName: "custody-agreements",
      filename: newFileName,
    });

    /** Update the pdf file in CustodyAgreementFile */
    const data = {
      name: pdfName,
      size: pdfSize,
      url: `${publicUrl}.pdf`,
      custodyAgreementId,
    };

    await db.custodyAgreementFile.upsert({
      where: { id: agreementFile?.id ?? "create-new" },
      update: data,
      create: data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error updating agreement PDF",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating the custody agreement PDF. Please try again or contact support.",
      additionalData: { custodyAgreementId },
      label,
    });
  }
}

export async function toggleCustodyAgreementActiveState({
  id,
  organizationId,
  organizations,
}: Pick<CustodyAgreement, "id"> & {
  organizationId: Organization["id"];
  organizations: Pick<
    Organization,
    "id" | "type" | "name" | "imageId" | "userId"
  >[];
}) {
  try {
    const agreement = await db.custodyAgreement.findFirst({
      where: { id, organizationId },
      select: { id: true, isActive: true },
    });
    if (!agreement) {
      throw new ShelfError({
        cause: null,
        label,
        title: "Agreement not found",
        message: "The active state of the agreement could not be toggled.",
      });
    }

    /** If user is activating the agreement then make sure it is under the limit */
    if (!agreement.isActive) {
      await assertUserCanActivateMoreAgreements({
        organizationId,
        organizations,
      });
    }

    const updatedAgreement = await db.custodyAgreement.update({
      where: { id: agreement.id },
      data: { isActive: !agreement.isActive },
    });
    return updatedAgreement;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error changing agreement",
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while making the custody agreement active/inactive. Please try again or contact support.",
      additionalData: { id },
      label,
    });
  }
}

export async function makeCustodyAgreementDefault({
  id,
  organizationId,
}: {
  id: CustodyAgreement["id"];
  organizationId: Organization["id"];
}) {
  try {
    // Make all the agreements of the same type of the user non-default
    await db.custodyAgreement.updateMany({
      where: { type: CustodyAgreementType.CUSTODY, organizationId },
      data: { isDefault: false },
    });

    // Make the selected agreement default
    await db.custodyAgreement.update({
      where: { id, organizationId },
      data: { isDefault: true },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error making agreement default",
      message:
        "Something went wrong while making the custody agreement default. Please try again or contact support.",
      additionalData: { id },
      label,
    });
  }
}

export async function getCustodyAgreementById({
  id,
  organizationId,
}: {
  id: CustodyAgreement["id"];
  organizationId: CustodyAgreement["organizationId"];
}) {
  try {
    const agreement = await db.custodyAgreement.findUniqueOrThrow({
      where: { id, organizationId },
    });

    return agreement;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Agreement not found",
      message:
        "The agreement you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id },
      label,
    });
  }
}

export async function getLatestCustodyAgreementFile(
  id: CustodyAgreement["id"]
) {
  try {
    /** There is only one agreement file associated with an Agreement */
    const agreementFile = await db.custodyAgreementFile.findFirst({
      where: { custodyAgreementId: id },
    });

    return agreementFile;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error fetching agreement file",
      message:
        "Something went wrong while fetching the custody agreement file. Please try again or contact support.",
      additionalData: { id },
      label,
    });
  }
}

export async function getCustodyAgreements({
  organizationId,
  page = 1,
  perPage = 8,
}: {
  organizationId: Organization["id"];
  page?: number;
  perPage?: number;
}) {
  try {
    const where = {
      organizationId,
    };

    const [custodyAgreements, totalCustodyAgreements] = await Promise.all([
      db.custodyAgreement.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: perPage,
        skip: (page - 1) * perPage,
      }),
      db.custodyAgreement.count({ where }),
    ]);

    return {
      custodyAgreements,
      totalCustodyAgreements,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error fetching agreements",
      message:
        "Something went wrong while fetching the custody agreements. Please try again or contact support.",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function getAgreementByCustodyId({
  custodyId,
  organizationId,
}: {
  custodyId: Custody["id"];
  organizationId?: Asset["organizationId"];
}) {
  try {
    const custody = await db.custody.findUnique({
      where: { id: custodyId },
      include: {
        asset: {
          select: {
            id: true,
            title: true,
            organizationId: true,
            user: { select: { email: true } },
          },
        },
        agreement: true,
        custodian: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
    if (!custody) {
      throw new ShelfError({
        cause: null,
        title: "Not found",
        message: "Custody not found",
        label,
      });
    }

    if (organizationId && organizationId !== custody.asset.organizationId) {
      throw new ShelfError({
        cause: null,
        message: "This custody belongs to any other organization.",
        label,
      });
    }

    const custodyAgreement = custody.agreement;
    if (!custodyAgreement) {
      throw new ShelfError({
        cause: null,
        message: "There is not agreement associated with this custody.",
        label,
      });
    }

    const custodian = custody.custodian;
    if (!custodian) {
      throw new ShelfError({
        cause: null,
        message: "Custodian not found.",
        label: "Assets",
      });
    }

    return {
      asset: custody.asset,
      custodyAgreement,
      custody,
      custodian,
    };
  } catch (cause) {
    const message = isLikeShelfError(cause)
      ? cause.message
      : "Something went wrong while fetching the custody agreement. Please try again or contact support.";
    throw new ShelfError({
      cause,
      title: "Error fetching agreement",
      message,
      additionalData: { organizationId },
      label,
    });
  }
}

export async function getAgreementByAssetId({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Asset["organizationId"];
}) {
  try {
    const custody = await db.custody.findUnique({
      where: { assetId },
    });

    if (!custody) {
      throw new ShelfError({
        cause: null,
        message: "There is no custody over this asset",
        label,
      });
    }

    return await getAgreementByCustodyId({
      custodyId: custody.id,
      organizationId,
    });
  } catch (cause) {
    const message = isLikeShelfError(cause)
      ? cause.message
      : "Something went wrong while fetching the custody agreement. Please try again or contact support.";
    throw new ShelfError({
      cause,
      title: "Error fetching agreement",
      message,
      additionalData: { organizationId },
      label,
    });
  }
}

export async function canUserUpdateAgreementFile({
  agreementId,
  organizationId,
}: {
  agreementId: CustodyAgreement["id"];
  organizationId: Organization["id"];
}) {
  try {
    /**
     * A user can update the agreement file only if no CustodyReceipt exists for this agreement.
     */
    const receipts = await db.custodyReceipt.count({
      where: {
        organizationId,
        agreementId,
      },
    });

    return receipts === 0;
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message:
        "Something went wrong while checking if you can update agreement file.",
    });
  }
}
