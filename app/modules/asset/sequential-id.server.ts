/* eslint-disable no-console */
import { db } from "~/database/db.server";

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
    await db.$executeRaw`SELECT create_asset_sequence_for_org(${organizationId})`;
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
    const result = await db.$queryRaw<[{ get_next_sequential_id: string }]>`
      SELECT get_next_sequential_id(${organizationId}, ${prefix})
    `;

    return result[0].get_next_sequential_id;
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
    // Ensure sequence exists without consuming a value
    await createOrganizationSequence(organizationId);

    // Get current sequence value without incrementing
    const result = await db.$queryRaw<[{ currval: bigint }]>`
      SELECT currval('org_' || ${organizationId} || '_asset_sequence') as currval
    `;

    const nextValue = Number(result[0].currval) + 1;
    return formatSequentialId(nextValue, prefix);
  } catch (_error) {
    // If currval fails, sequence might not have been used yet
    // Find the highest existing sequential ID using proper numeric extraction
    // This avoids string sorting issues when IDs go beyond 9999
    const maxExisting = await db.$queryRaw<[{ max_num: number | null }]>`
      SELECT COALESCE(MAX(
        CASE 
          WHEN "sequentialId" ~ ('^' || ${prefix} || '-[0-9]+$')
          THEN CAST(SUBSTRING("sequentialId" FROM (${prefix} || '-([0-9]+)')) AS INTEGER)
          ELSE 0 
        END
      ), 0) as max_num
      FROM "Asset"
      WHERE "organizationId" = ${organizationId} 
      AND "sequentialId" IS NOT NULL
    `;

    const highestNumber = maxExisting[0]?.max_num || 0;
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
    await db.$executeRaw`SELECT reset_asset_sequence_for_org(${organizationId})`;
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
    const count = await db.asset.count({
      where: {
        organizationId,
        sequentialId: { not: null },
      },
    });

    return count > 0;
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
    return await db.asset.count({
      where: {
        organizationId,
        sequentialId: null,
      },
    });
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
    // Ensure sequence exists
    await createOrganizationSequence(organizationId);

    // First, find the highest existing sequential ID to avoid conflicts
    // Using proper regex pattern [0-9]+ instead of \d to handle 1000+ assets
    const maxExisting = await db.$queryRaw<[{ max_num: number | null }]>`
      SELECT COALESCE(MAX(
        CASE 
          WHEN "sequentialId" ~ ('^' || ${prefix} || '-[0-9]+$')
          THEN CAST(SUBSTRING("sequentialId" FROM (${prefix} || '-([0-9]+)')) AS INTEGER)
          ELSE 0 
        END
      ), 0) as max_num
      FROM "Asset"
      WHERE "organizationId" = ${organizationId} 
      AND "sequentialId" IS NOT NULL
    `;

    const startingNumber = (maxExisting[0]?.max_num || 0) + 1;

    // The CTE approach is creating duplicates - let's use batch processing instead
    // First, get all asset IDs that need sequential IDs, ordered consistently
    const assetIds = await db.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM "Asset" 
      WHERE "organizationId" = ${organizationId} 
      AND "sequentialId" IS NULL
      ORDER BY id ASC
    `;

    // Process in smaller batches to avoid memory issues and ensure atomicity
    const BATCH_SIZE = 1000;
    let totalUpdated = 0;

    for (let i = 0; i < assetIds.length; i += BATCH_SIZE) {
      const batch = assetIds.slice(i, i + BATCH_SIZE);
      const batchStartNum = startingNumber + i;

      // Create array of values for batch update
      const values = batch.map((asset, index) => ({
        id: asset.id,
        sequentialId: `${prefix}-${String(batchStartNum + index).padStart(
          Math.max(4, String(startingNumber + assetIds.length).length),
          "0"
        )}`,
      }));

      // Update this batch
      const batchResult = await db.$executeRaw`
        UPDATE "Asset" 
        SET "sequentialId" = batch_data.sequential_id
        FROM (
          SELECT unnest(${values.map((v) => v.id)}::text[]) as id,
                 unnest(${values.map(
                   (v) => v.sequentialId
                 )}::text[]) as sequential_id
        ) as batch_data
        WHERE "Asset".id::text = batch_data.id
        AND "Asset"."sequentialId" IS NULL
      `;

      totalUpdated += Number(batchResult);
      console.log(
        `🔧 DEBUG: Processed batch ${
          Math.floor(i / BATCH_SIZE) + 1
        }: ${batchResult} assets updated`
      );
    }

    const result = totalUpdated;
    // Update the sequence to continue from the right place for new assets
    const totalAssetsWithIds = await db.asset.count({
      where: {
        organizationId,
        sequentialId: { not: null },
      },
    });

    await db.$executeRaw`
      SELECT setval(
        'org_' || ${organizationId} || '_asset_sequence', 
        GREATEST(${totalAssetsWithIds}, 1)
      )
    `;

    console.log(
      `Generated bulk sequential IDs for organization ${organizationId}: ${result} assets updated, starting from ${prefix}-${String(
        startingNumber
      ).padStart(4, "0")}`
    );

    return Number(result);
  } catch (error) {
    console.error(
      `Failed to efficiently generate bulk sequential IDs for organization ${organizationId}:`,
      error
    );
    throw new Error(`Could not generate sequential IDs for existing assets`);
  }
}
