import type { Barcode, Organization, User, Asset, Kit } from "@prisma/client";
import { BarcodeType } from "@prisma/client";
import { db } from "~/database/db.server";
import type { ErrorLabel } from "~/utils/error";
import {
  ShelfError,
  maybeUniqueConstraintViolation,
  VALIDATION_ERROR,
  isLikeShelfError,
} from "~/utils/error";
import type { ValidationError } from "~/utils/http";
import { validateBarcodeValue, normalizeBarcodeValue } from "./validation";
import type { CreateAssetFromContentImportPayload } from "../asset/types";

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
  assetId?: Asset["id"];
  kitId?: Kit["id"];
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
    // Validate barcode value format (preserve case for ExternalQR)
    const normalizedValue = normalizeBarcodeValue(type, value);
    const validationError = validateBarcodeValue(type, normalizedValue);
    if (validationError) {
      throw new ShelfError({
        cause: null,
        message: validationError,
        status: 400,
        additionalData: { type, value, organizationId },
        label,
      });
    }

    const barcode = await db.barcode.create({
      data: {
        type,
        value: normalizedValue, // Preserve case for ExternalQR, uppercase others
        organizationId,
        ...(assetId && { assetId }),
        ...(kitId && { kitId }),
      },
    });
    return barcode;
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;

      if (target && target.includes("value")) {
        // Use existing validation function for detailed error messages
        const relationshipType = assetId ? "asset" : "kit";
        try {
          await validateBarcodeUniqueness(
            [{ type, value }],
            organizationId,
            undefined, // No currentItemId for creates
            relationshipType as "asset" | "kit"
          );
        } catch (validationError) {
          // Re-throw the detailed validation error
          throw validationError;
        }
      }
    }

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

    // Validate all barcode values first (preserve case for ExternalQR)
    for (const barcode of barcodes) {
      const normalizedValue = normalizeBarcodeValue(
        barcode.type,
        barcode.value
      );
      const validationError = validateBarcodeValue(
        barcode.type,
        normalizedValue
      );
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

    // Let Prisma handle unique constraint violations for performance

    // Use createMany for bulk insert performance
    await db.barcode.createMany({
      data: barcodes.map((barcode) => ({
        type: barcode.type,
        value: normalizeBarcodeValue(barcode.type, barcode.value),
        organizationId,
        ...(assetId && { assetId }),
        ...(kitId && { kitId }),
      })),
    });
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;

      if (target && target.includes("value")) {
        // Use existing validation function for detailed error messages
        const relationshipType = assetId ? "asset" : "kit";
        try {
          await validateBarcodeUniqueness(
            barcodes,
            organizationId,
            undefined, // No currentItemId for creates
            relationshipType as "asset" | "kit"
          );
        } catch (validationError) {
          // Re-throw the detailed validation error
          throw validationError;
        }
      }
    }

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
  assetId,
  kitId,
}: UpdateBarcodeParams): Promise<Barcode> {
  try {
    const updateData: Partial<Pick<Barcode, "type" | "value">> = {};

    if (type !== undefined) {
      updateData.type = type;
    }

    if (value !== undefined && type !== undefined) {
      updateData.value = normalizeBarcodeValue(type, value);
    }

    // Validate new values if provided (preserve case for ExternalQR)
    if (type !== undefined && value !== undefined) {
      const normalizedValue = normalizeBarcodeValue(type, value);
      const validationError = validateBarcodeValue(type, normalizedValue);
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

    const barcode = await db.barcode.update({
      where: { id, organizationId },
      data: updateData,
    });
    return barcode;
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;

      if (target && target.includes("value") && value !== undefined) {
        const relationshipType = assetId ? "asset" : "kit";
        const currentItemId = assetId || kitId;

        try {
          await validateBarcodeUniqueness(
            [{ type: type || "Code128", value }], // Use provided type or default
            organizationId,
            currentItemId,
            relationshipType as "asset" | "kit"
          );
        } catch (validationError) {
          // Re-throw the detailed validation error
          throw validationError;
        }
      }
    }

    throw maybeUniqueConstraintViolation(cause, "Barcode", {
      additionalData: { id, type, value, organizationId, assetId, kitId },
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
export async function getBarcodeByValue<
  T = {
    asset: boolean;
    kit: boolean;
  },
>({
  value,
  organizationId,
  include,
}: {
  value: string;
  organizationId: Organization["id"];
  include?: T;
}): Promise<any> {
  try {
    // Try to find barcode with original case first (for ExternalQR), then uppercase (for other types)
    const barcode = await db.barcode.findFirst({
      where: {
        OR: [
          { value: value }, // Try original case first (ExternalQR)
          { value: value.toUpperCase() }, // Try uppercase (other barcode types)
        ],
        organizationId,
      },
      include: include || {
        asset: true,
        kit: true,
      },
    });
    return barcode;
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
    const barcodes = await db.barcode.findMany({
      where: {
        assetId,
        organizationId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    return barcodes;
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
    const barcodes = await db.barcode.findMany({
      where: {
        kitId,
        organizationId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });
    return barcodes;
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
    // If it's already a ShelfError with validation errors, re-throw as is
    if (
      cause instanceof ShelfError &&
      cause.additionalData?.[VALIDATION_ERROR]
    ) {
      throw cause;
    }

    throw new ShelfError({
      cause,
      message: "Failed to replace barcodes",
      additionalData: { barcodes, assetId, kitId, organizationId, userId },
      label,
    });
  }
}

/**
 * Validates that all barcode values are unique within the organization
 * Throws ShelfError with validation errors if duplicates are found
 */
export async function validateBarcodeUniqueness(
  barcodes: { type: BarcodeType; value: string }[],
  organizationId: Organization["id"],
  currentItemId?: string,
  relationshipType?: "asset" | "kit"
): Promise<void> {
  const validationErrors: ValidationError<any> = {};

  // Check for duplicates within the submitted barcodes
  const duplicateIndexes = new Set<number>();
  const seenValues = new Map<string, number>();

  for (let i = 0; i < barcodes.length; i++) {
    const normalizedValue = normalizeBarcodeValue(
      barcodes[i].type,
      barcodes[i].value
    );

    if (seenValues.has(normalizedValue)) {
      // Mark both the first occurrence and current as duplicates
      const firstIndex = seenValues.get(normalizedValue)!;
      duplicateIndexes.add(firstIndex);
      duplicateIndexes.add(i);
    } else {
      seenValues.set(normalizedValue, i);
    }
  }

  // OPTIMIZED: Single query to get all existing barcodes with these values
  const submittedValues = barcodes.map((b) =>
    b.type === BarcodeType.ExternalQR ? b.value : b.value.toUpperCase()
  );

  const isEditing = !!currentItemId && !!relationshipType;
  const existingBarcodes = await db.barcode.findMany({
    where: {
      value: { in: submittedValues },
      organizationId,
    },
    include: {
      asset: { select: { title: true } },
      kit: { select: { name: true } },
    },
  });

  // Filter out the current item manually
  const filteredExistingBarcodes = isEditing
    ? existingBarcodes.filter((barcode) => {
        if (relationshipType === "asset") {
          return barcode.assetId !== currentItemId;
        } else {
          return barcode.kitId !== currentItemId;
        }
      })
    : existingBarcodes;

  // Create a map for O(1) lookup: value -> existing barcode info
  const existingValueMap = new Map<
    string,
    (typeof filteredExistingBarcodes)[0]
  >();
  filteredExistingBarcodes.forEach((barcode) => {
    existingValueMap.set(barcode.value, barcode);
  });

  // Check each submitted barcode against the map
  for (let i = 0; i < barcodes.length; i++) {
    const barcode = barcodes[i];
    const normalizedValue = normalizeBarcodeValue(barcode.type, barcode.value);
    const existingBarcode = existingValueMap.get(normalizedValue);

    if (existingBarcode) {
      const itemName =
        existingBarcode.asset?.title ||
        existingBarcode.kit?.name ||
        "Unknown item";
      validationErrors[`barcodes[${i}].value`] = {
        message: `This barcode value is already used by "${itemName}"`,
      };
    } else if (duplicateIndexes.has(i)) {
      validationErrors[`barcodes[${i}].value`] = {
        message: "This barcode value is duplicated in the form",
      };
    }
  }

  if (Object.keys(validationErrors).length > 0) {
    throw new ShelfError({
      cause: null,
      message:
        "Some barcode values are already in use. Please use unique values.",
      status: 400,
      additionalData: { [VALIDATION_ERROR]: validationErrors },
      shouldBeCaptured: false,
      label,
    });
  }
}

/**
 * Update barcodes for an asset efficiently using ID-based matching
 */
export async function updateBarcodes({
  barcodes,
  assetId,
  kitId,
  organizationId,
  userId,
}: {
  barcodes: { id?: string; type: BarcodeType; value: string }[];
  assetId?: Asset["id"];
  kitId?: Kit["id"];
  organizationId: Organization["id"];
  userId: User["id"];
}): Promise<void> {
  try {
    // Validate all barcode values first (preserve case for ExternalQR)
    for (const barcode of barcodes) {
      const normalizedValue = normalizeBarcodeValue(
        barcode.type,
        barcode.value
      );
      const validationError = validateBarcodeValue(
        barcode.type,
        normalizedValue
      );
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

    // Let Prisma handle unique constraint violations for performance

    // Get existing barcodes
    const existingBarcodes = await db.barcode.findMany({
      where: {
        organizationId,
        ...(assetId && { assetId }),
        ...(kitId && { kitId }),
      },
    });

    // Separate barcodes into updates and creates
    const barcodesToUpdate = barcodes.filter((barcode) => barcode.id);
    const barcodesToCreate = barcodes.filter((barcode) => !barcode.id);

    // Find barcodes to delete (existing ones not in the new list)
    const submittedIds = new Set(barcodes.map((b) => b.id).filter(Boolean));
    const barcodesToDelete = existingBarcodes.filter(
      (existing) => !submittedIds.has(existing.id)
    );

    const operations = [];

    // Update existing barcodes
    for (const barcode of barcodesToUpdate) {
      operations.push(
        db.barcode.update({
          where: {
            id: barcode.id!,
            organizationId, // Security: ensure the barcode belongs to this org
          },
          data: {
            type: barcode.type,
            value: normalizeBarcodeValue(barcode.type, barcode.value),
          },
        })
      );
    }

    // Create new barcodes
    for (const barcode of barcodesToCreate) {
      operations.push(
        db.barcode.create({
          data: {
            type: barcode.type,
            value: normalizeBarcodeValue(barcode.type, barcode.value),
            organizationId,
            ...(assetId && { assetId }),
            ...(kitId && { kitId }),
          },
        })
      );
    }

    // Delete removed barcodes
    if (barcodesToDelete.length > 0) {
      operations.push(
        db.barcode.deleteMany({
          where: {
            id: { in: barcodesToDelete.map((b) => b.id) },
            organizationId, // Security: ensure we only delete from this org
          },
        })
      );
    }

    // Execute all operations in a transaction
    await db.$transaction(operations);
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;

      if (target && target.includes("value")) {
        // Use existing validation function for detailed error messages
        const currentItemId = assetId || kitId;
        const relationshipType = assetId ? "asset" : "kit";
        try {
          await validateBarcodeUniqueness(
            barcodes,
            organizationId,
            currentItemId,
            relationshipType as "asset" | "kit"
          );
        } catch (validationError) {
          // Re-throw the detailed validation error
          throw validationError;
        }
        // If validateBarcodeUniqueness completes without throwing,
        // it means no duplicates were found, so continue with the generic error
      }
    }

    throw maybeUniqueConstraintViolation(cause, "Barcode", {
      additionalData: { barcodes, assetId, kitId, organizationId, userId },
    });
  }
}

/**
 * Extracts barcodes from import data and validates them for import
 * Similar to QR code import validation - checks for duplicates and organization ownership
 */
export type BarcodePerImportedAsset = {
  key: string;
  title: string;
  barcodes: { type: BarcodeType; value: string; existingId?: string }[];
};

export async function parseBarcodesFromImportData({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  try {
    const barcodePerAsset: BarcodePerImportedAsset[] = [];

    // Extract barcode data from each asset
    data.forEach((asset) => {
      const assetBarcodes: { type: BarcodeType; value: string }[] = [];

      // Check each barcode type column
      const barcodeTypes: { column: string; type: BarcodeType }[] = [
        { column: "barcode_Code128", type: "Code128" },
        { column: "barcode_Code39", type: "Code39" },
        { column: "barcode_DataMatrix", type: "DataMatrix" },
        { column: "barcode_ExternalQR", type: "ExternalQR" },
      ];

      barcodeTypes.forEach(({ column, type }) => {
        const columnValue = asset[column];
        if (
          columnValue &&
          typeof columnValue === "string" &&
          columnValue.trim()
        ) {
          // Split comma-separated values and validate each
          const values = columnValue
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
          values.forEach((value) => {
            // Validate barcode format (preserve case for ExternalQR)
            const normalizedValue = normalizeBarcodeValue(type, value);
            const validationError = validateBarcodeValue(type, normalizedValue);
            if (validationError) {
              throw new ShelfError({
                cause: null,
                message: `Invalid ${type} barcode "${value}" for asset "${asset.title}": ${validationError}`,
                additionalData: { asset: asset.title, type, value },
                label,
                shouldBeCaptured: false,
              });
            }
            assetBarcodes.push({ type, value: normalizedValue });
          });
        }
      });

      // Only add to results if asset has barcodes
      if (assetBarcodes.length > 0) {
        barcodePerAsset.push({
          key: asset.key,
          title: asset.title,
          barcodes: assetBarcodes,
        });
      }
    });

    if (barcodePerAsset.length === 0) {
      return []; // No barcodes to validate
    }

    // Collect all barcode values for duplicate checking
    const allBarcodeValues: string[] = [];
    const barcodeSourceMap = new Map<
      string,
      { assetTitle: string; type: BarcodeType }
    >();

    barcodePerAsset.forEach((asset) => {
      asset.barcodes.forEach((barcode) => {
        allBarcodeValues.push(barcode.value);
        barcodeSourceMap.set(barcode.value, {
          assetTitle: asset.title,
          type: barcode.type,
        });
      });
    });

    // Check for duplicates within the import data
    const duplicateValues = allBarcodeValues.filter(
      (value, index, self) => self.indexOf(value) !== index
    );

    if (duplicateValues.length > 0) {
      const duplicateDetails = duplicateValues.map((value) => {
        const source = barcodeSourceMap.get(value);
        return `${value} (${source?.type}) for asset "${source?.assetTitle}"`;
      });

      throw new ShelfError({
        cause: null,
        message: `Some barcodes appear multiple times in the import data. Each barcode must be unique: ${duplicateDetails.join(
          ", "
        )}`,
        additionalData: { duplicateValues, duplicateDetails },
        label,
        shouldBeCaptured: false,
      });
    }

    // Check existing barcodes in the current organization only
    const existingBarcodes = await db.barcode.findMany({
      where: {
        value: { in: allBarcodeValues },
        organizationId, // Only check within current organization
      },
      include: {
        asset: { select: { title: true } },
        kit: { select: { name: true } },
      },
    });

    // Check for barcodes already linked to assets or kits in this organization
    const linkedBarcodes = existingBarcodes.filter(
      (barcode) => barcode.assetId || barcode.kitId
    );

    if (linkedBarcodes.length > 0) {
      const linkedDetails = linkedBarcodes.map((barcode) => {
        const source = barcodeSourceMap.get(barcode.value);
        const linkedTo =
          barcode.asset?.title || barcode.kit?.name || "Unknown item";
        return `${barcode.value} (${source?.type}) - already linked to "${linkedTo}"`;
      });

      throw new ShelfError({
        cause: null,
        message: `Some barcodes are already linked to other assets or kits in your organization. Please use unlinked barcodes: ${linkedDetails.join(
          ", "
        )}`,
        additionalData: { linkedBarcodes: linkedDetails },
        label,
        shouldBeCaptured: false,
      });
    }

    // Create a map of existing orphaned barcodes that can be reused
    const orphanedBarcodeMap = new Map<string, string>();
    existingBarcodes
      .filter((barcode) => !barcode.assetId && !barcode.kitId) // Only orphaned barcodes
      .forEach((barcode) => {
        orphanedBarcodeMap.set(barcode.value, barcode.id);
      });

    // Add existing IDs to barcodes that can be reused
    return barcodePerAsset.map((asset) => ({
      ...asset,
      barcodes: asset.barcodes.map((barcode) => ({
        ...barcode,
        existingId: orphanedBarcodeMap.get(barcode.value),
      })),
    }));
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);
    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Failed to process barcodes from import data",
      additionalData: {
        data: data.length,
        userId,
        organizationId,
        ...(isShelfError && cause.additionalData),
      },
      label,
    });
  }
}
