import type { Barcode, BarcodeType, Organization, User, Asset, Kit } from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, maybeUniqueConstraintViolation } from "~/utils/error";
import { validateBarcodeValue } from "./validation";

const label: ErrorLabel = "Barcode";

export interface CreateBarcodeParams {
  type: BarcodeType;
  value: string;
  organizationId: Organization["id"];
  userId: User["id"];
  assetId?: Asset["id"];
  kitId?: Kit["id"];
}

export interface UpdateBarcodeParams {
  id: Barcode["id"];
  type?: BarcodeType;
  value?: string;
  organizationId: Organization["id"];
}

/**
 * Create a single barcode
 */
export async function createBarcode({
  type,
  value,
  organizationId,
  userId,
  assetId,
  kitId,
}: CreateBarcodeParams): Promise<Barcode> {
  try {
    // Validate barcode value format
    const validationError = validateBarcodeValue(type, value);
    if (validationError) {
      throw new ShelfError({
        cause: null,
        message: validationError,
        status: 400,
        additionalData: { type, value, organizationId },
        label,
      });
    }

    return await db.barcode.create({
      data: {
        type,
        value: value.toUpperCase(), // Normalize to uppercase
        organizationId,
        ...(assetId && { assetId }),
        ...(kitId && { kitId }),
      },
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Barcode", {
      additionalData: { type, value, organizationId, userId, assetId, kitId },
    });
  }
}

/**
 * Create multiple barcodes for an asset or kit using createMany for performance
 */
export async function createBarcodes({
  barcodes,
  organizationId,
  userId,
  assetId,
  kitId,
}: {
  barcodes: { type: BarcodeType; value: string }[];
  organizationId: Organization["id"];
  userId: User["id"];
  assetId?: Asset["id"];
  kitId?: Kit["id"];
}): Promise<void> {
  try {
    if (!barcodes || barcodes.length === 0) {
      return;
    }

    // Validate all barcode values first
    for (const barcode of barcodes) {
      const validationError = validateBarcodeValue(barcode.type, barcode.value);
      if (validationError) {
        throw new ShelfError({
          cause: null,
          message: `Invalid barcode "${barcode.value}": ${validationError}`,
          status: 400,
          additionalData: { barcodes, organizationId },
          label,
        });
      }
    }

    // Use createMany for bulk insert performance
    await db.barcode.createMany({
      data: barcodes.map((barcode) => ({
        type: barcode.type,
        value: barcode.value.toUpperCase(),
        organizationId,
        ...(assetId && { assetId }),
        ...(kitId && { kitId }),
      })),
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Barcode", {
      additionalData: { barcodes, organizationId, userId, assetId, kitId },
    });
  }
}

/**
 * Update a barcode
 */
export async function updateBarcode({
  id,
  type,
  value,
  organizationId,
}: UpdateBarcodeParams): Promise<Barcode> {
  try {
    const updateData: Partial<Pick<Barcode, "type" | "value">> = {};

    if (type !== undefined) {
      updateData.type = type;
    }

    if (value !== undefined) {
      updateData.value = value.toUpperCase();
    }

    // Validate new values if provided
    if (type !== undefined && value !== undefined) {
      const validationError = validateBarcodeValue(type, value);
      if (validationError) {
        throw new ShelfError({
          cause: null,
          message: validationError,
          status: 400,
          additionalData: { id, type, value, organizationId },
          label,
        });
      }
    }

    return await db.barcode.update({
      where: { id, organizationId },
      data: updateData,
    });
  } catch (cause) {
    throw maybeUniqueConstraintViolation(cause, "Barcode", {
      additionalData: { id, type, value, organizationId },
    });
  }
}

/**
 * Delete a barcode
 */
export async function deleteBarcode({
  id,
  organizationId,
}: {
  id: Barcode["id"];
  organizationId: Organization["id"];
}): Promise<void> {
  try {
    await db.barcode.delete({
      where: { id, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete barcode",
      additionalData: { id, organizationId },
      label,
    });
  }
}

/**
 * Delete all barcodes for an asset or kit
 */
export async function deleteBarcodes({
  assetId,
  kitId,
  organizationId,
}: {
  assetId?: Asset["id"];
  kitId?: Kit["id"];
  organizationId: Organization["id"];
}): Promise<void> {
  try {
    await db.barcode.deleteMany({
      where: {
        organizationId,
        ...(assetId && { assetId }),
        ...(kitId && { kitId }),
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to delete barcodes",
      additionalData: { assetId, kitId, organizationId },
      label,
    });
  }
}

/**
 * Get barcode by value within organization
 */
export async function getBarcodeByValue({
  value,
  organizationId,
}: {
  value: string;
  organizationId: Organization["id"];
}): Promise<Barcode | null> {
  try {
    return await db.barcode.findFirst({
      where: {
        value: value.toUpperCase(),
        organizationId,
      },
      include: {
        asset: true,
        kit: true,
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to find barcode",
      additionalData: { value, organizationId },
      label,
    });
  }
}

/**
 * Get all barcodes for an asset
 */
export async function getAssetBarcodes({
  assetId,
  organizationId,
}: {
  assetId: Asset["id"];
  organizationId: Organization["id"];
}): Promise<Barcode[]> {
  try {
    return await db.barcode.findMany({
      where: {
        assetId,
        organizationId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get asset barcodes",
      additionalData: { assetId, organizationId },
      label,
    });
  }
}

/**
 * Get all barcodes for a kit
 */
export async function getKitBarcodes({
  kitId,
  organizationId,
}: {
  kitId: Kit["id"];
  organizationId: Organization["id"];
}): Promise<Barcode[]> {
  try {
    return await db.barcode.findMany({
      where: {
        kitId,
        organizationId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to get kit barcodes",
      additionalData: { kitId, organizationId },
      label,
    });
  }
}

/**
 * Replace all barcodes for an asset (used in updates)
 */
export async function replaceBarcodes({
  barcodes,
  assetId,
  kitId,
  organizationId,
  userId,
}: {
  barcodes: { type: BarcodeType; value: string }[];
  assetId?: Asset["id"];
  kitId?: Kit["id"];
  organizationId: Organization["id"];
  userId: User["id"];
}): Promise<void> {
  try {
    // Delete existing barcodes
    await deleteBarcodes({ assetId, kitId, organizationId });

    // Create new barcodes using createMany for performance
    if (barcodes && barcodes.length > 0) {
      await createBarcodes({
        barcodes,
        assetId,
        kitId,
        organizationId,
        userId,
      });
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to replace barcodes",
      additionalData: { barcodes, assetId, kitId, organizationId, userId },
      label,
    });
  }
}