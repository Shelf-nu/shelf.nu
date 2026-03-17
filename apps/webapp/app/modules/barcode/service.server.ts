import type { Barcode, Organization, User, Asset, Kit } from "@prisma/client";
import { BarcodeType } from "@prisma/client";
import type { Sb } from "@shelf/database";
import { db } from "~/database/db.server";
import { sbDb } from "~/database/supabase.server";
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

    const insertData: Record<string, unknown> = {
      type,
      value: normalizedValue, // Preserve case for ExternalQR, uppercase others
      organizationId,
    };
    if (assetId) insertData.assetId = assetId;
    if (kitId) insertData.kitId = kitId;

    const { data: barcode, error } = await sbDb
      .from("Barcode")
      .insert(insertData as Sb.BarcodeInsert)
      .select()
      .single();

    if (error) throw error;
    return barcode as unknown as Barcode;
  } catch (cause) {
    // If it's a unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    const err = cause as any;
    if (err?.code === "P2002" || err?.code === "23505") {
      const target = err?.meta?.target || err?.message || "";
      if (
        (typeof target === "string" && target.includes("value")) ||
        (Array.isArray(target) && target.includes("value"))
      ) {
        const relationshipType = assetId ? "asset" : "kit";
        await validateBarcodeUniqueness(
          [{ type, value }],
          organizationId,
          undefined, // No currentItemId for creates
          relationshipType as "asset" | "kit"
        );
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

    // Use Supabase bulk insert for performance
    const insertRows = barcodes.map((barcode) => {
      const row: Record<string, unknown> = {
        type: barcode.type,
        value: normalizeBarcodeValue(barcode.type, barcode.value),
        organizationId,
      };
      if (assetId) row.assetId = assetId;
      if (kitId) row.kitId = kitId;
      return row;
    });

    const { error } = await sbDb
      .from("Barcode")
      .insert(insertRows as Sb.BarcodeInsert[]);

    if (error) throw error;
  } catch (cause) {
    // If it's a unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    const err = cause as any;
    if (err?.code === "P2002" || err?.code === "23505") {
      const target = err?.meta?.target || err?.message || "";
      if (
        (typeof target === "string" && target.includes("value")) ||
        (Array.isArray(target) && target.includes("value"))
      ) {
        const relationshipType = assetId ? "asset" : "kit";
        await validateBarcodeUniqueness(
          barcodes,
          organizationId,
          undefined, // No currentItemId for creates
          relationshipType as "asset" | "kit"
        );
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

    const { data: barcode, error } = await sbDb
      .from("Barcode")
      .update(updateData)
      .eq("id", id)
      .eq("organizationId", organizationId)
      .select()
      .single();

    if (error) throw error;
    return barcode as unknown as Barcode;
  } catch (cause) {
    // If it's a unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    const err = cause as any;
    if (err?.code === "P2002" || err?.code === "23505") {
      const target = err?.meta?.target || err?.message || "";
      if (
        value !== undefined &&
        ((typeof target === "string" && target.includes("value")) ||
          (Array.isArray(target) && target.includes("value")))
      ) {
        const relationshipType = assetId ? "asset" : "kit";
        const currentItemId = assetId || kitId;

        await validateBarcodeUniqueness(
          [{ type: type || "Code128", value }],
          organizationId,
          currentItemId,
          relationshipType as "asset" | "kit"
        );
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
  id: string;
  organizationId: string;
}): Promise<void> {
  try {
    const { error } = await sbDb
      .from("Barcode")
      .delete()
      .eq("id", id)
      .eq("organizationId", organizationId);

    if (error) throw error;
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
  assetId?: string;
  kitId?: string;
  organizationId: string;
}): Promise<void> {
  try {
    let query = sbDb
      .from("Barcode")
      .delete()
      .eq("organizationId", organizationId);

    if (assetId) query = query.eq("assetId", assetId);
    if (kitId) query = query.eq("kitId", kitId);

    const { error } = await query;

    if (error) throw error;
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
  assetId: string;
  organizationId: string;
}): Promise<Sb.BarcodeRow[]> {
  try {
    const { data, error } = await sbDb
      .from("Barcode")
      .select("*")
      .eq("assetId", assetId)
      .eq("organizationId", organizationId)
      .order("createdAt", { ascending: true });

    if (error) throw error;

    return data;
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
  kitId: string;
  organizationId: string;
}): Promise<Sb.BarcodeRow[]> {
  try {
    const { data, error } = await sbDb
      .from("Barcode")
      .select("*")
      .eq("kitId", kitId)
      .eq("organizationId", organizationId)
      .order("createdAt", { ascending: true });

    if (error) throw error;

    return data;
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

    // Get existing barcodes
    let existingQuery = sbDb
      .from("Barcode")
      .select()
      .eq("organizationId", organizationId);

    if (assetId) existingQuery = existingQuery.eq("assetId", assetId);
    if (kitId) existingQuery = existingQuery.eq("kitId", kitId);

    const { data: existingBarcodes, error: fetchError } = await existingQuery;
    if (fetchError) throw fetchError;

    // Separate barcodes into updates and creates
    const barcodesToUpdate = barcodes.filter((barcode) => barcode.id);
    const barcodesToCreate = barcodes.filter((barcode) => !barcode.id);

    // Find barcodes to delete (existing ones not in the new list)
    const submittedIds = new Set(barcodes.map((b) => b.id).filter(Boolean));
    const barcodesToDelete = (existingBarcodes || []).filter(
      (existing) => !submittedIds.has(existing.id)
    );

    const operations: PromiseLike<unknown>[] = [];

    // Update existing barcodes
    for (const barcode of barcodesToUpdate) {
      operations.push(
        sbDb
          .from("Barcode")
          .update({
            type: barcode.type,
            value: normalizeBarcodeValue(barcode.type, barcode.value),
          })
          .eq("id", barcode.id!)
          .eq("organizationId", organizationId)
          .then(({ error }) => {
            if (error) throw error;
          })
      );
    }

    // Create new barcodes
    if (barcodesToCreate.length > 0) {
      const insertRows = barcodesToCreate.map((barcode) => {
        const row: Record<string, unknown> = {
          type: barcode.type,
          value: normalizeBarcodeValue(barcode.type, barcode.value),
          organizationId,
        };
        if (assetId) row.assetId = assetId;
        if (kitId) row.kitId = kitId;
        return row;
      });

      operations.push(
        sbDb
          .from("Barcode")
          .insert(insertRows as Sb.BarcodeInsert[])
          .then(({ error }) => {
            if (error) throw error;
          })
      );
    }

    // Delete removed barcodes
    if (barcodesToDelete.length > 0) {
      operations.push(
        sbDb
          .from("Barcode")
          .delete()
          .in(
            "id",
            barcodesToDelete.map((b) => b.id)
          )
          .eq("organizationId", organizationId)
          .then(({ error }) => {
            if (error) throw error;
          })
      );
    }

    // Execute all operations (no longer in a Prisma transaction,
    // but individual operations are atomic via PostgREST)
    await Promise.all(operations);
  } catch (cause) {
    // If it's a unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    const err = cause as any;
    if (err?.code === "P2002" || err?.code === "23505") {
      const target = err?.meta?.target || err?.message || "";
      if (
        (typeof target === "string" && target.includes("value")) ||
        (Array.isArray(target) && target.includes("value"))
      ) {
        const currentItemId = assetId || kitId;
        const relationshipType = assetId ? "asset" : "kit";
        await validateBarcodeUniqueness(
          barcodes,
          organizationId,
          currentItemId,
          relationshipType as "asset" | "kit"
        );

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
  row: number;
  barcodes: { type: BarcodeType; value: string; existingId?: string }[];
};

/** Represents a barcode value that appears on multiple assets in the import data */
export type DuplicateBarcode = {
  /** The barcode value (e.g. "05743") */
  value: string;
  /** The assets that share this barcode value */
  assets: {
    /** Asset title from the CSV */
    title: string;
    /** The barcode type for this occurrence (e.g. "Code128", "EAN13") */
    type: BarcodeType;
    /** Row number in the CSV file (1-based, includes header) */
    row: number;
  }[];
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
    data.forEach((asset, index) => {
      const assetBarcodes: { type: BarcodeType; value: string }[] = [];

      // Check each barcode type column
      const barcodeTypes: { column: string; type: BarcodeType }[] = [
        { column: "barcode_Code128", type: "Code128" },
        { column: "barcode_Code39", type: "Code39" },
        { column: "barcode_DataMatrix", type: "DataMatrix" },
        { column: "barcode_ExternalQR", type: "ExternalQR" },
        { column: "barcode_EAN13", type: "EAN13" },
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
          row: index + 2, // +1 for header row, +1 for 0-based index
          barcodes: assetBarcodes,
        });
      }
    });

    if (barcodePerAsset.length === 0) {
      return []; // No barcodes to validate
    }

    // Collect all barcode values and track which assets use each
    const allBarcodeValues: string[] = [];
    const barcodeAssetsMap = new Map<
      string,
      { title: string; type: BarcodeType; row: number }[]
    >();

    barcodePerAsset.forEach((asset) => {
      asset.barcodes.forEach((barcode) => {
        allBarcodeValues.push(barcode.value);
        const existing = barcodeAssetsMap.get(barcode.value);
        const entry = {
          title: asset.title,
          type: barcode.type,
          row: asset.row,
        };
        if (existing) {
          existing.push(entry);
        } else {
          barcodeAssetsMap.set(barcode.value, [entry]);
        }
      });
    });

    // Check for duplicates within the import data
    const duplicateBarcodes: DuplicateBarcode[] = [];
    for (const [value, assets] of barcodeAssetsMap) {
      if (assets.length > 1) {
        duplicateBarcodes.push({
          value,
          assets,
        });
      }
    }

    if (duplicateBarcodes.length > 0) {
      throw new ShelfError({
        cause: null,
        title: "Duplicate barcodes in import data",
        message:
          "Some barcodes appear multiple times in the import data. Each barcode must be unique.",
        additionalData: { duplicateBarcodes },
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
        const sources = barcodeAssetsMap.get(barcode.value);
        const linkedTo =
          barcode.asset?.title || barcode.kit?.name || "Unknown item";
        return `${barcode.value} (${sources?.[0]?.type}) - already linked to "${linkedTo}"`;
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
