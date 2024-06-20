import type {
  Asset,
  Organization,
  PrintBatch,
  Prisma,
  Qr,
  User,
} from "@prisma/client";
import type { LoaderFunctionArgs } from "@remix-run/node";
import QRCode from "qrcode-generator";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { gifToPng } from "~/utils/gif-to-png";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
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

export async function getQr(id: Qr["id"]) {
  try {
    return await db.qr.findUniqueOrThrow({
      where: { id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This QR code doesn't exist or it doesn't belong to your current organization.",
      title: "QR code not found",
      status: 404,
      additionalData: { id },
      label,
    });
  }
}

export async function createQr({
  userId,
  assetId,
  organizationId,
}: Pick<Qr, "userId" | "organizationId" | "assetId">) {
  const data = {
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

export async function generateCode({
  version,
  errorCorrection,
  qr,
  size,
}: {
  version: TypeNumber;
  errorCorrection: ErrorCorrectionLevel;
  qr: Qr;
  size: "cable" | "small" | "medium" | "large";
}) {
  try {
    const code = QRCode(version, errorCorrection);
    code.addData(`${process.env.SERVER_URL}/qr/${qr.id}`);
    code.make();

    /** We use a margin of 0 because we handle this using canvas in the client */
    const sizes = {
      cable: [1, 0], // 29px => 0.8cm(0.77)
      small: [2, 0], // 58px => 1.5cm(1.53)
      medium: [4, 0], // 116px => 3.1cm(3.07)
      large: [6, 0], // 174px => 4.7cm(4.6)
    };
    const src = await gifToPng(code.createDataURL(...sizes[size]));

    return {
      sizes,
      code: {
        size: size,
        src,
        id: qr.id,
      },
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while generating the QR code. Please try again or contact support.",
      additionalData: { version, errorCorrection, qr, size },
      label,
    });
  }
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
      message: "Failed to generate orphaned codes",
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
      status: 403,
      additionalData: { qrId, organizationId },
      label,
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
    const qr = await getQr(id);
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
