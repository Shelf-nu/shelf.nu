/* eslint-disable no-console */
import { sbDb } from "~/database/supabase.server";

/**
 * Sequential ID Service for Assets
 *
 * Provides functions to manage PostgreSQL sequences for generating
 * organization-scoped sequential asset IDs in the format: PREFIX-NNNN
 *
 * Examples: SAM-0001, SAM-0002, SAM-9999, SAM-10000
 */

const DEFAULT_PREFIX = "SAM";

/**
 * Creates a PostgreSQL sequence for an organization if it doesn't exist
 */
export async function createOrganizationSequence(
  organizationId: string
): Promise<void> {
  try {
    const { error } = await sbDb.rpc("create_asset_sequence_for_org", {
      org_id: organizationId,
    });

    if (error) throw error;
  } catch (error) {
    console.error(
      `Failed to create sequence for organization ${organizationId}:`,
      error
    );
    throw new Error(`Could not create asset sequence for organization`);
  }
}

/**
 * Gets the next sequential ID for an organization using PostgreSQL sequences
 * Automatically creates the sequence if it doesn't exist
 * WARNING: This function consumes the sequence value - only use when actually creating assets
 *
 * @param organizationId - The organization ID
 * @param prefix - The prefix for the sequential ID (default: "SAM")
 * @returns Promise<string> - The formatted sequential ID (e.g., "SAM-0001")
 */
export async function getNextSequentialId(
  organizationId: string,
  prefix: string = DEFAULT_PREFIX
): Promise<string> {
  try {
    const { data, error } = await sbDb.rpc("get_next_sequential_id", {
      org_id: organizationId,
      prefix,
    });

    if (error) throw error;

    return data as string;
  } catch (error) {
    console.error(
      `Failed to get next sequential ID for organization ${organizationId}:`,
      error
    );
    throw new Error(`Could not generate sequential ID`);
  }
}

/**
 * Estimates what the next sequential ID would be without consuming the sequence
 * Safe to use for previews and UI display purposes
 *
 * @param organizationId - The organization ID
 * @param prefix - The prefix for the sequential ID (default: "SAM")
 * @returns Promise<string> - The estimated sequential ID (e.g., "SAM-0042")
 */
export async function estimateNextSequentialId(
  organizationId: string,
  prefix: string = DEFAULT_PREFIX
): Promise<string> {
  try {
    const { data, error } = await sbDb.rpc("estimate_next_sequential_id", {
      org_id: organizationId,
      prefix,
    });

    if (error) throw error;

    return data as string;
  } catch (error) {
    console.error(
      `Failed to estimate next sequential ID for organization ${organizationId}:`,
      error
    );
    // Fallback: use the max existing ID + 1
    const { data: maxNum } = await sbDb.rpc("get_max_sequential_id_number", {
      org_id: organizationId,
      prefix,
    });

    const highestNumber = (maxNum as number) || 0;
    return formatSequentialId(highestNumber + 1, prefix);
  }
}

/**
 * Formats a sequence number into a sequential ID
 * Uses 4-digit zero-padding that grows beyond 9999
 *
 * @param sequenceNumber - The sequence number from the database
 * @param prefix - The prefix for the sequential ID (default: "SAM")
 * @returns string - The formatted sequential ID
 */
export function formatSequentialId(
  sequenceNumber: number,
  prefix: string = DEFAULT_PREFIX
): string {
  const paddedNumber = sequenceNumber.toString().padStart(4, "0");
  return `${prefix}-${paddedNumber}`;
}

/**
 * Resets an organization's sequence to match existing sequential IDs
 * Used during bulk generation for existing assets
 *
 * @param organizationId - The organization ID
 */
export async function resetOrganizationSequence(
  organizationId: string
): Promise<void> {
  try {
    const { error } = await sbDb.rpc("reset_asset_sequence_for_org", {
      org_id: organizationId,
    });

    if (error) throw error;
  } catch (error) {
    console.error(
      `Failed to reset sequence for organization ${organizationId}:`,
      error
    );
    throw new Error(`Could not reset asset sequence for organization`);
  }
}

/**
 * Checks if an organization has any assets with sequential IDs
 * Used to determine if bulk generation is needed
 *
 * @param organizationId - The organization ID
 * @returns Promise<boolean> - True if any assets have sequential IDs
 */
export async function organizationHasSequentialIds(
  organizationId: string
): Promise<boolean> {
  try {
    const { count, error } = await sbDb
      .from("Asset")
      .select("*", { count: "exact", head: true })
      .eq("organizationId", organizationId)
      .not("sequentialId", "is", null);

    if (error) throw error;

    return (count ?? 0) > 0;
  } catch (error) {
    console.error(
      `Failed to check sequential IDs for organization ${organizationId}:`,
      error
    );
    return false;
  }
}

/**
 * Gets count of assets without sequential IDs for an organization
 * Used for progress tracking during bulk generation
 *
 * @param organizationId - The organization ID
 * @returns Promise<number> - Number of assets without sequential IDs
 */
export async function getAssetsWithoutSequentialIdCount(
  organizationId: string
): Promise<number> {
  try {
    const { count, error } = await sbDb
      .from("Asset")
      .select("*", { count: "exact", head: true })
      .eq("organizationId", organizationId)
      .is("sequentialId", null);

    if (error) throw error;

    return count ?? 0;
  } catch (error) {
    console.error(
      `Failed to count assets without sequential IDs for organization ${organizationId}:`,
      error
    );
    return 0;
  }
}

/**
 * Validates that a sequential ID follows the expected format
 *
 * @param sequentialId - The sequential ID to validate
 * @returns boolean - True if the format is valid
 */
export function isValidSequentialIdFormat(sequentialId: string): boolean {
  // Pattern: PREFIX-NNNN (where PREFIX is letters and NNNN is numbers with at least 4 digits)
  const pattern = /^[A-Z]+-\d{4,}$/;
  return pattern.test(sequentialId);
}

/**
 * Extracts the numeric part from a sequential ID
 *
 * @param sequentialId - The sequential ID (e.g., "SAM-0001")
 * @returns number | null - The numeric part or null if invalid
 */
export function extractSequenceNumber(sequentialId: string): number | null {
  if (!isValidSequentialIdFormat(sequentialId)) {
    return null;
  }

  const parts = sequentialId.split("-");
  if (parts.length !== 2) {
    return null;
  }

  const number = parseInt(parts[1], 10);
  return isNaN(number) ? null : number;
}

/**
 * Efficiently generates sequential IDs for existing assets using SQL
 * This is much faster for large datasets as it does everything in the database
 *
 * @param organizationId - The organization ID
 * @param prefix - The prefix for sequential IDs (default: "SAM")
 * @returns Promise<number> - Number of assets updated
 */
export async function generateBulkSequentialIdsEfficient(
  organizationId: string,
  prefix: string = DEFAULT_PREFIX
): Promise<number> {
  try {
    const { data, error } = await sbDb.rpc("generate_bulk_sequential_ids", {
      org_id: organizationId,
      prefix,
    });

    if (error) throw error;

    const result = data as number;

    console.log(
      `Generated bulk sequential IDs for organization ${organizationId}: ${result} assets updated`
    );

    return result;
  } catch (error) {
    console.error(
      `Failed to efficiently generate bulk sequential IDs for organization ${organizationId}:`,
      error
    );
    throw new Error(`Could not generate sequential IDs for existing assets`);
  }
}
