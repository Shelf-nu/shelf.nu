import {
  type Asset,
  type Organization,
  type PrintBatch,
  type Prisma,
  type Qr,
  type User,
  type Kit,
} from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { getParamsValues } from "~/utils/list";
// eslint-disable-next-line import/no-cycle
import { generateCode } from "./utils.server";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import { generateRandomCode } from "../invite/helpers";

const label: ErrorLabel = "QR";

export async function getQrByAssetId({ assetId }: Pick<Qr, "assetId">) {
  try {
    return await db.qr.findFirst({
      where: { assetId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the QR. Please try again or contact support.",
      additionalData: { assetId },
      label,
    });
  }
}

export async function getQrByKitId({ kitId }: Pick<Qr, "kitId">) {
  try {
    return await db.qr.findFirst({
      where: { kitId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the QR. Please try again or contact support.",
      additionalData: { kitId },
      label,
    });
  }
}

type QrWithInclude<T extends Prisma.QrInclude | undefined> =
  T extends Prisma.QrInclude ? Prisma.QrGetPayload<{ include: T }> : Qr;

export async function getQr<T extends Prisma.QrInclude | undefined>({
  id,
  include,
}: Pick<Asset, "id"> & {
  include?: T;
}): Promise<QrWithInclude<T>> {
  try {
    const qr = await db.qr.findUniqueOrThrow({
      where: { id },
      include: { ...include },
    });

    return qr as QrWithInclude<T>;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This QR code doesn't exist or it doesn't belong to your current organization.",
      title: "QR code not found",
      status: 404,
      additionalData: { id },
      label,
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

export async function createQr({
  userId,
  assetId,
  kitId,
  organizationId,
}: Pick<Qr, "userId" | "organizationId"> & {
  assetId?: Asset["id"];
  kitId?: Kit["id"];
}) {
  const data = {
    id: id(),
    ...(userId && {
      user: {
        connect: {
          id: userId,
        },
      },
    }),
    ...(assetId && {
      asset: {
        connect: {
          id: assetId,
        },
      },
    }),
    ...(kitId && {
      kit: {
        connect: {
          id: kitId,
        },
      },
    }),
    ...(organizationId && {
      organization: {
        connect: {
          id: organizationId,
        },
      },
    }),
  };

  return db.qr.create({
    data,
  });
}

/** Generates codes that are not attached to assets but attached to a certain org and user */
export async function generateOrphanedCodes({
  userId,
  amount,
  organizationId,
}: {
  userId: User["id"];
  amount: number;
  organizationId: Organization["id"];
}) {
  try {
    const data = Array.from({ length: amount }).map(() => ({
      userId,
      organizationId,
      id: id(),
    }));

    return await db.qr.createMany({
      data: data,
      skipDuplicates: true,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to generate orphaned codes",
      additionalData: { userId, amount, organizationId },
      label,
    });
  }
}

/** Generates codes that are not attached to assets, user or organization */
export async function generateUnclaimedCodesForPrint({
  amount,
  batchName,
}: {
  amount: number;
  batchName?: string;
}) {
  try {
    batchName = batchName || generateRandomCode(10);
    /**
     * We create an array of empty objects to create the amount of codes requested
     */

    const batch = await db.printBatch.create({
      data: {
        name: batchName,
      },
    });

    const data = Array.from({ length: amount }).map(() => ({
      // Generating codes also prints them so unclaimed codes are marked as printed
      // We generate a random code for the batch
      batchId: batch.id,
      id: id(),
    }));

    await db.qr.createMany({
      data,
      skipDuplicates: true,
    });

    return await db.qr.findMany({
      where: {
        batch: {
          name: {
            equals: batchName,
          },
        },
      },
      include: {
        batch: true,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Failed to generate orphaned codes",
      additionalData: { amount },
      label,
    });
  }
}

export async function assertWhetherQrBelongsToCurrentOrganization({
  request,
  organizationId,
}: {
  request: Request;
  organizationId: Organization["id"];
}) {
  const searchParams = getCurrentSearchParams(request);
  const qrId = searchParams.get("qrId");

  try {
    /** We have the case when someone could be linking a QR that doesnt belong to the current org */
    if (qrId) {
      await db.qr.findUniqueOrThrow({
        where: {
          id: qrId,
          organizationId,
        },
      });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This QR code doesn't exist or it doesn't belong to your current organization. A new asset cannot be linked to it.",
      title: "QR code not found",
      status: 404,
      additionalData: { qrId, organizationId },
      label,
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

export const getPaginatedAndFilterableQrCodes = async ({
  request,
}: {
  request: LoaderFunctionArgs["request"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search, batch, perPageParam } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const { qrCodes, totalQrCodes } = await getQrCodes({
      page,
      perPage,
      search,
      batch,
    });
    const totalPages = Math.ceil(totalQrCodes / perPage);

    return {
      page,
      perPage,
      search,
      totalQrCodes,
      qrCodes,
      totalPages,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get paginated and qr codes",
      additionalData: { page, search },
      label,
    });
  }
};

async function getQrCodes({
  page = 1,
  perPage = 8,
  search,
  batch,
}: {
  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;

  batch?: PrintBatch["id"] | "No batch" | null;
}) {
  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 100 per page

    /** Default value of where. Takes the assets belonging to current user */
    let where: Prisma.QrWhereInput = {};

    /** If the search string exists, add it to the where object
     */
    if (search) {
      where.id = {
        contains: search,
        mode: "insensitive",
      };
    }

    if (batch) {
      where.batchId =
        batch === "No batch"
          ? {
              equals: null,
            }
          : batch;
    }

    const [qrCodes, totalQrCodes] = await Promise.all([
      /** Get the users */
      db.qr.findMany({
        skip,
        take,
        include: {
          asset: {
            select: {
              id: true,
              title: true,
            },
          },
          kit: {
            select: {
              id: true,
              name: true,
            },
          },
          organization: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          batch: true,
        },
        where,
        orderBy: { createdAt: "desc" },
      }),

      /** Count them */
      db.qr.count({ where }),
    ]);

    return { qrCodes, totalQrCodes };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get qr codes",
      additionalData: { page, perPage, search },
      label,
    });
  }
}

/** Generates codes that are not attached to assets but attached to a certain org and user */
export async function markBatchAsPrinted({ batch }: { batch: string }) {
  try {
    const updatedBatch = await db.printBatch.update({
      where: {
        id: batch,
      },
      data: {
        printed: true,
      },
    });
    return updatedBatch;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to mark batch as printed",
      additionalData: { batch },
      label,
    });
  }
}

/** Claims a unclaimed code by linking it to an organization and user */
export async function claimQrCode({
  id,
  organizationId,
  userId,
}: {
  id: Qr["id"];
  organizationId: Organization["id"];
  userId: User["id"];
}) {
  try {
    /** First, just in case we check whether its claimed */
    const qr = await getQr({ id });
    if (qr.organizationId) {
      throw new ShelfError({
        message:
          "This QR code already belongs to an organization so you cannot claim it.",
        title: "QR code already claimed",
        status: 403,
        additionalData: { id, organizationId, userId },
        label,
        cause: null,
      });
    }

    return await db.qr.update({
      where: {
        id,
      },
      data: {
        organizationId,
        userId,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to claim qr code",
      additionalData: { id, organizationId, userId },
      label,
    });
  }
}

interface QRCodeMapParams {
  assets: Asset[];
  organizationId: string;
  userId: string;
  size: "small" | "medium" | "large" | "cable";
}

export async function getQrCodeMaps({
  assets,
  size,
}: QRCodeMapParams): Promise<Map<string, string>> {
  const finalMap = new Map<string, string>();

  try {
    const qrCodePromises = assets.map(async (asset) => {
      try {
        let qr = await getQrByAssetId({ assetId: asset.id });
        const qrCode = qr
          ? await generateCode({
              version: qr.version as TypeNumber,
              errorCorrection: qr.errorCorrection as ErrorCorrectionLevel,
              size,
              qr,
            })
          : null;
        if (qrCode?.code) {
          finalMap.set(asset.id, qrCode?.code?.src || "");
        }
      } catch (error) {
        // Handle the error if needed
        // eslint-disable-next-line no-console
        console.error(`Error processing asset with id ${asset.id}:`, error);
      }
    });

    await Promise.all(qrCodePromises);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Error generating QR code maps:", err);
  }
  return finalMap;
}

/** Extracts qrCodes from data and checks their validity for import
 * You can only import unclaimed or unlinked codes
 * - For non-existing codes - we can allow them to be imported
 * - For linked codes - we don't allow any imports
 * - For unlinked - we can only allowed if the code is already claimed within the current workspace the user is trying to import to
 * - For unclaimed - there are not really any limitations we need to place. This should work directly
 */

export type QRCodePerImportedAsset = {
  title: string;
  qrId: string;
};

export async function parseQrCodesFromImportData({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    const qrCodePerAsset = data
      .map((asset) => {
        if (asset.qrId) {
          return {
            title: asset.title,
            qrId: asset.qrId,
          };
        }
        return null;
      })
      .filter((asset) => asset !== null); // Filter out null values

    const codes = await db.qr.findMany({
      where: {
        id: {
          in: qrCodePerAsset.map((asset) => asset?.qrId),
        },
      },
    });

    /** Check for any codes that are present more than 1 time in the data */
    const duplicateCodes = qrCodePerAsset.filter(
      (asset, index, self) =>
        self.findIndex((t) => t?.qrId === asset?.qrId) !== index
    );

    if (duplicateCodes.length) {
      throw new ShelfError({
        cause: null,
        message:
          "Some of the QR codes you are trying to import are present more than once in the data. Please make sure each QR code is only present once.",
        additionalData: { duplicateCodes },
        label,
      });
    }

    /** Check if any of the codes are non-existent */
    const nonExistentCodes = qrCodePerAsset.filter(
      (asset) => !codes.find((code) => code.id === asset?.qrId) && asset?.qrId
    );

    if (nonExistentCodes.length) {
      throw new ShelfError({
        cause: null,
        message: "Some of the QR codes you are trying to import do not exist",
        additionalData: { nonExistentCodes },
        label,
      });
    }

    /** Check for codes already linked to asset or kit. Returns QRCodePerImportedAsset[] */
    const linkedCodes = qrCodePerAsset.filter((asset) =>
      codes.find(
        (code) => code.id === asset?.qrId && (code.assetId || code.kitId)
      )
    );
    if (linkedCodes.length) {
      throw new ShelfError({
        cause: null,
        message:
          "Some of the QR codes you are trying to import are already linked to an asset or a kit. Please use unlinkned or unclaimed codes for your import.",
        additionalData: { linkedCodes },
        label,
      });
    }

    /** Check for codes linked to other any organization and the organization is different than the current one */
    const connectedToOtherOrgs = qrCodePerAsset.filter((asset) =>
      codes.find(
        (code) =>
          code.id === asset?.qrId &&
          code.organizationId &&
          code.organizationId !== organizationId
      )
    );
    if (connectedToOtherOrgs.length) {
      throw new ShelfError({
        cause: null,
        message:
          "Some of the QR codes you are trying to import don't belong to your current organization. You can only import codes that are unclaimed, unlinked or linked to your organization.",
        additionalData: { connectedToOtherOrgs },
        label,
      });
    }

    /** Check for codes that dont have org id. If they dont, update them to link them to current org */
    const unclaimedCodes = codes.filter((code) => !code.organizationId);
    if (unclaimedCodes.length) {
      await db.qr.updateMany({
        where: {
          id: {
            in: unclaimedCodes.map((code) => code.id),
          },
        },
        data: {
          organizationId,
          userId,
        },
      });
    }

    return qrCodePerAsset;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError ? cause.message : "Failed to get qr codes",
      additionalData: {
        data,
        userId,
        organizationId,
        ...(isShelfError && cause.additionalData),
      },
      label,
    });
  }
}
