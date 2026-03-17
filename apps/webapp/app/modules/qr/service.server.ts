import type { Sb } from "@shelf/database";
import type { Prisma } from "@prisma/client";
import type { TypeNumber, ErrorCorrectionLevel } from "qrcode-generator";
import type { LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { sbDb } from "~/database/supabase.server";
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

export async function getQrByAssetId({ assetId }: { assetId: string | null }) {
  try {
    let query = sbDb.from("Qr").select("*");

    if (assetId === null) {
      query = query.is("assetId", null);
    } else {
      query = query.eq("assetId", assetId);
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) throw error;
    return data;
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

export async function getQrByKitId({ kitId }: { kitId: string | null }) {
  try {
    let query = sbDb.from("Qr").select("*");

    if (kitId === null) {
      query = query.is("kitId", null);
    } else {
      query = query.eq("kitId", kitId);
    }

    const { data, error } = await query.limit(1).maybeSingle();

    if (error) throw error;
    return data;
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

/** Simple Supabase-based getQr returning a flat Qr row */
export async function getQr({ id }: { id: string }) {
  try {
    const { data, error } = await sbDb
      .from("Qr")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This code doesn't exist or it doesn't belong to your current organization.",
      title: "QR code not found",
      status: 404,
      additionalData: { id },
      label,
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

/**
 * Prisma-based getQr with flexible include — used by the scanner route.
 * TODO: Remove once the scanner route is migrated to Supabase.
 */
type QrWithInclude<T extends Prisma.QrInclude | undefined> =
  T extends Prisma.QrInclude ? Prisma.QrGetPayload<{ include: T }> : Sb.QrRow;

export async function getQrWithInclude<T extends Prisma.QrInclude | undefined>({
  id: qrId,
  include,
}: {
  id: string;
  include?: T;
}): Promise<QrWithInclude<T>> {
  try {
    const qr = await db.qr.findUniqueOrThrow({
      where: { id: qrId },
      include: { ...include },
    });

    return qr as QrWithInclude<T>;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This code doesn't exist or it doesn't belong to your current organization.",
      title: "QR code not found",
      status: 404,
      additionalData: { id: qrId },
      label,
      shouldBeCaptured: !isNotFoundError(cause),
    });
  }
}

export async function getQrOrganizationLookup({ qrId }: { qrId: string }) {
  try {
    const { data: qr, error } = await sbDb
      .from("Qr")
      .select("organizationId")
      .eq("id", qrId)
      .maybeSingle();

    if (error) throw error;

    if (!qr) {
      throw new ShelfError({
        cause: null,
        message: "This code doesn't exist.",
        title: "QR code not found",
        status: 404,
        additionalData: { qrId },
        label,
      });
    }

    return qr;
  } catch (cause) {
    if (cause instanceof ShelfError) throw cause;
    throw new ShelfError({
      cause,
      message: "This code doesn't exist.",
      title: "QR code not found",
      status: 404,
      additionalData: { qrId },
      label,
    });
  }
}

export async function createQr({
  userId,
  assetId,
  kitId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
  assetId?: string;
  kitId?: string;
}) {
  try {
    const insertData: Record<string, unknown> = {
      id: id(),
    };

    if (userId) insertData.userId = userId;
    if (assetId) insertData.assetId = assetId;
    if (kitId) insertData.kitId = kitId;
    if (organizationId) insertData.organizationId = organizationId;

    const { data, error } = await sbDb
      .from("Qr")
      .insert(insertData as Sb.QrInsert)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating the QR code. Please try again or contact support.",
      additionalData: { userId, assetId, kitId, organizationId },
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
  userId: string;
  amount: number;
  organizationId: string;
}) {
  try {
    const data = Array.from({ length: amount }).map(() => ({
      userId,
      organizationId,
      id: id(),
    }));

    const { error, count } = await sbDb.from("Qr").upsert(data, {
      onConflict: "id",
      ignoreDuplicates: true,
      count: "exact",
    });

    if (error) throw error;
    return { count: count ?? 0 };
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

    const { data: batch, error: batchError } = await sbDb
      .from("PrintBatch")
      .insert({ name: batchName })
      .select()
      .single();

    if (batchError) throw batchError;

    const data = Array.from({ length: amount }).map(() => ({
      batchId: batch.id,
      id: id(),
    }));

    const { error: insertError } = await sbDb
      .from("Qr")
      .upsert(data, { onConflict: "id", ignoreDuplicates: true });

    if (insertError) throw insertError;

    const { data: qrCodes, error: fetchError } = await sbDb
      .from("Qr")
      .select("*, batch:PrintBatch(*)")
      .eq("batchId", batch.id);

    if (fetchError) throw fetchError;
    return qrCodes;
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
  organizationId: string;
}) {
  const searchParams = getCurrentSearchParams(request);
  const qrId = searchParams.get("qrId");

  try {
    /** We have the case when someone could be linking a QR that doesnt belong to the current org */
    if (qrId) {
      const { data, error } = await sbDb
        .from("Qr")
        .select("id")
        .eq("id", qrId)
        .eq("organizationId", organizationId)
        .single();

      if (error) throw error;
      if (!data) {
        throw new Error("QR not found");
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "This code doesn't exist or it doesn't belong to your current organization. A new asset cannot be linked to it.",
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

  batch?: string | "No batch" | null;
}) {
  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 100 per page

    let query = sbDb
      .from("Qr")
      .select(
        "*, asset:Asset(id, title), kit:Kit(id, name), organization:Organization(id, name), user:User(id, email, firstName, lastName), batch:PrintBatch(*)",
        { count: "exact" }
      );

    if (search) {
      query = query.ilike("id", `%${search}%`);
    }

    if (batch) {
      if (batch === "No batch") {
        query = query.is("batchId", null);
      } else {
        query = query.eq("batchId", batch);
      }
    }

    const {
      data: qrCodes,
      count,
      error,
    } = await query
      .order("createdAt", { ascending: false })
      .range(skip, skip + take - 1);

    if (error) throw error;
    return { qrCodes: qrCodes ?? [], totalQrCodes: count ?? 0 };
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
    const { data: updatedBatch, error } = await sbDb
      .from("PrintBatch")
      .update({ printed: true })
      .eq("id", batch)
      .select()
      .single();

    if (error) throw error;
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
  id: qrId,
  organizationId,
  userId,
}: {
  id: string;
  organizationId: string;
  userId: string;
}) {
  try {
    /** First, just in case we check whether its claimed */
    const qr = await getQr({ id: qrId });
    if (qr.organizationId) {
      throw new ShelfError({
        message:
          "This QR code already belongs to an organization so you cannot claim it.",
        title: "QR code already claimed",
        status: 403,
        additionalData: { id: qrId, organizationId, userId },
        label,
        cause: null,
      });
    }

    const { data, error } = await sbDb
      .from("Qr")
      .update({ organizationId, userId })
      .eq("id", qrId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to claim qr code",
      additionalData: { id: qrId, organizationId, userId },
      label,
    });
  }
}

interface AssetWithQrCodes {
  id: string;
  qrCodes: Array<{
    id: string;
    version: number;
    errorCorrection: string;
  }>;
}

interface QRCodeMapParams {
  assets: AssetWithQrCodes[];
  organizationId: string;
  userId: string;
  size: "small" | "medium" | "large" | "cable";
}

export async function getQrCodeMaps({
  assets,
  size,
}: QRCodeMapParams): Promise<Record<string, string>> {
  const finalObject: Record<string, string> = {};

  try {
    const qrCodePromises = assets.map(async (asset) => {
      try {
        const qr = asset.qrCodes[0];
        const qrCode = qr
          ? await generateCode({
              version: qr.version as TypeNumber,
              errorCorrection: qr.errorCorrection as ErrorCorrectionLevel,
              size,
              qr,
            })
          : null;

        if (qrCode?.code) {
          finalObject[asset.id] = qrCode.code.src || "";
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

  return finalObject;
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
  userId: string;
  organizationId: string;
}) {
  try {
    const qrCodePerAsset = data
      .map((asset) => {
        if (asset.qrId) {
          return {
            key: asset.key,
            title: asset.title,
            qrId: asset.qrId,
          };
        }
        return null;
      })
      .filter((asset) => asset !== null); // Filter out null values

    const { data: codes, error: fetchError } = await sbDb
      .from("Qr")
      .select("*")
      .in(
        "id",
        qrCodePerAsset.map((asset) => asset?.qrId)
      );

    if (fetchError) throw fetchError;
    const codesArr = codes ?? [];

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
      (asset) =>
        !codesArr.find((code) => code.id === asset?.qrId) && asset?.qrId
    );

    if (nonExistentCodes.length) {
      throw new ShelfError({
        cause: null,
        message: "Some of the QR codes you are trying to import do not exist",
        additionalData: { nonExistentCodes },
        label,
        shouldBeCaptured: false,
      });
    }

    /** Check for codes already linked to asset or kit. Returns QRCodePerImportedAsset[] */
    const linkedCodes = qrCodePerAsset.filter((asset) =>
      codesArr.find(
        (code) => code.id === asset?.qrId && (code.assetId || code.kitId)
      )
    );
    if (linkedCodes.length) {
      throw new ShelfError({
        cause: null,
        message:
          "Some of the QR codes you are trying to import are already linked to an asset or a kit. Please use unlinked or unclaimed codes for your import.",
        additionalData: { linkedCodes },
        label,
      });
    }

    /** Check for codes linked to other any organization and the organization is different than the current one */
    const connectedToOtherOrgs = qrCodePerAsset.filter((asset) =>
      codesArr.find(
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
    const unclaimedCodes = codesArr.filter((code) => !code.organizationId);
    if (unclaimedCodes.length) {
      const { error: updateError } = await sbDb
        .from("Qr")
        .update({ organizationId, userId })
        .in(
          "id",
          unclaimedCodes.map((code) => code.id)
        );

      if (updateError) throw updateError;
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
