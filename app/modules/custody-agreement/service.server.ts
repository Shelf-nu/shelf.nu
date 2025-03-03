import type {
  Prisma,
  Organization,
  User,
  Asset,
  CustodyAgreement,
} from "@prisma/client";
import { AssetStatus, CustodyAgreementType } from "@prisma/client";
import { v4 } from "uuid";
import { db } from "~/database/db.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";
import { resolveTeamMemberName } from "~/utils/user";
import { createNote } from "../note/service.server";

export async function createCustodyAgreement({
  name,
  description,
  signatureRequired,
  userId,
  organizationId,
}: Pick<CustodyAgreement, "name" | "description" | "signatureRequired"> & {
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
    } satisfies Prisma.CustodyAgreementCreateInput;

    return await db.custodyAgreement.create({ data });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error creating agreement",
      message:
        "Something went wrong while creating the custody agreement. Please try again or contact support.",
      additionalData: { name, description, signatureRequired },
      label: "Custody Agreement",
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
     * we need to set the asset custody to "AVAILABLE" and furthermore, ask the custodian to sign
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
        // Set the asset status to AVAILABLE
        await db.asset.update({
          where: { id: custody.assetId },
          data: { status: AssetStatus.AVAILABLE },
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
      label: "Custody Agreement",
    });
  }
}

export async function createCustodyAgreementRevision({
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
    const custodyAgreement = await db.custodyAgreement.findUniqueOrThrow({
      where: { id: custodyAgreementId, organizationId },
    });

    const pdfHash = v4();
    const newFileName = `${organizationId}/${custodyAgreementId}/${pdfHash}`;
    const fileData = await parseFileFormData({
      request,
      bucketName: "custody-agreements",
      newFileName,
    });

    const pdf = fileData.get("pdf") as string;

    if (!pdf) return null;

    const publicUrl = await getPublicFileURL({
      bucketName: "custody-agreements",
      filename: newFileName,
    });

    const [updatedAgreement, newRevision] = await db.$transaction([
      // Update the latest revision of the agreement
      db.custodyAgreement.update({
        where: { id: custodyAgreementId, organizationId },
        data: {
          lastRevision: custodyAgreement.lastRevision + 1,
        },
      }),

      // Create a new revision of the agreement PDF
      db.custodyAgreementFile.create({
        data: {
          name: pdfName,
          size: pdfSize,
          url: `${publicUrl}.pdf`,
          revision: custodyAgreement.lastRevision + 1,
          custodyAgreementId,
        },
      }),
    ]);

    return { updatedAgreement, newRevision };
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error updating agreement PDF",
      message:
        "Something went wrong while updating the custody agreement PDF. Please try again or contact support.",
      additionalData: { custodyAgreementId },
      label: "Custody Agreement",
    });
  }
}

export function toggleCustodyAgreementActiveState({
  id,
  organizationId,
  active,
}: Pick<CustodyAgreement, "id"> & {
  organizationId: Organization["id"];
  active: boolean;
}) {
  try {
    return db.custodyAgreement.update({
      where: { id, organizationId },
      data: {
        isActive: active,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error making agreement inactive",
      message:
        "Something went wrong while making the custody agreement active/inactive. Please try again or contact support.",
      additionalData: { id },
      label: "Custody Agreement",
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
    return await db.custodyAgreement.update({
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
      label: "Custody Agreement",
    });
  }
}

export async function getCustodyAgreementById(id: CustodyAgreement["id"]) {
  try {
    const agreement = await db.custodyAgreement.findUniqueOrThrow({
      where: { id },
    });

    return agreement;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Agreement not found",
      message:
        "The agreement you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { id },
      label: "Custody Agreement",
    });
  }
}

export async function getLatestCustodyAgreementFile(
  id: CustodyAgreement["id"]
) {
  try {
    const agreementFile = await db.custodyAgreementFile.findFirst({
      where: { custodyAgreementId: id },
      orderBy: { revision: "desc" },
    });

    return agreementFile;
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Error fetching agreement file",
      message:
        "Something went wrong while fetching the custody agreement file. Please try again or contact support.",
      additionalData: { id },
      label: "Custody Agreement",
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
      label: "Custody Agreement",
    });
  }
}

export async function getAgreementByAssetIdWithCustodian({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId?: Asset["organizationId"];
}) {
  try {
    const asset = await db.asset.findUniqueOrThrow({
      where: { id: assetId, organizationId },
      select: {
        id: true,
        title: true,
        custody: {
          include: {
            agreement: true,
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    id: true,
                    email: true,
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const custodyAgreement = asset.custody?.agreement;
    const custody = asset.custody;
    const custodian = custody?.custodian;

    if (!custodyAgreement) {
      throw new ShelfError({
        cause: null,
        message: "Agreement not found.",
        label: "Assets",
      });
    }

    if (!custodian) {
      throw new ShelfError({
        cause: null,
        message: "Custodian not found.",
        label: "Assets",
      });
    }

    return {
      asset: {
        id: asset.id,
        title: asset.title,
      },
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
      label: "Custody Agreement",
    });
  }
}
