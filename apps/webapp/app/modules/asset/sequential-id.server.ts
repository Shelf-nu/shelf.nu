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
 * The highest number currently issued under `prefix` in this organization.
 *
 * Read from the assets themselves rather than from the sequence, because the
 * two can disagree — the sequence is a counter that anything may have moved,
 * while the assets are the ids that actually exist and that
 * `(organizationId, sequentialId)` is unique on.
 *
 * Numeric extraction, not string ordering: `SAM-9` sorts after `SAM-10` as
 * text. Ids under a different prefix count as 0, since they cannot collide
 * with one issued under this one.
 *
 * @param organizationId - The organization to look within
 * @param prefix - The id prefix to measure, e.g. `SAM`
 * @returns The highest number issued, or `0` when none has been issued
 */
async function getHighestIssuedNumber(
  organizationId: string,
  prefix: string
): Promise<number> {
  const rows = await db.$queryRaw<[{ max_num: number | null }]>`
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

  return rows[0]?.max_num || 0;
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
    // Ensure the sequence exists (this does not consume a value).
    await createOrganizationSequence(organizationId);

    // Read the sequence's persisted counter from the pg_sequences catalog rather than
    // calling currval(). currval() is SESSION-LOCAL: it only returns a value when
    // nextval() was already called in the *same* backend session. Behind Supabase's
    // Supavisor connection pooler (transaction mode) each statement can run on a
    // different backend, so this page's session had almost never run nextval() for the
    // org's sequence — currval() then threw "currval of sequence ... is not yet defined
    // in this session" (SQLSTATE 55000) on every New Asset page load, flooding the
    // Postgres error logs. pg_sequences.last_value is session-independent and works in
    // every pooling mode. It is NULL when the sequence has never been advanced (i.e. the
    // org has not created any assets yet), in which case we fall through to the
    // max-based estimate below.
    const seqResult = await db.$queryRaw<{ last_value: bigint | null }[]>`
      SELECT last_value
      FROM pg_sequences
      WHERE schemaname = 'public'
        AND sequencename = 'org_' || ${organizationId} || '_asset_sequence'
    `;

    const lastValue = seqResult[0]?.last_value;
    if (lastValue != null) {
      // The sequence has been advanced; the next value nextval() will hand out is
      // last_value + 1 (the sequences are created with the default CACHE 1, so
      // last_value reflects the real last value dispensed).
      return formatSequentialId(Number(lastValue) + 1, prefix);
    }
    // Sequence exists but has never been advanced -> fall through to the max-based
    // estimate (handles the "org has no assets yet" case).
  } catch (error) {
    // Non-fatal: any failure reading the sequence just falls back to the max-based
    // estimate below. Logged (not swallowed) so a genuinely broken catalog read is
    // still visible, while no longer emitting a Postgres ERROR on every page load.
    console.error(
      `Failed to read asset sequence for organization ${organizationId}, falling back to max scan:`,
      error
    );
  }

  // Fallback: derive the estimate from the highest existing sequential ID using proper
  // numeric extraction. This avoids string-sorting issues once IDs grow beyond 9999.
  const highestNumber = await getHighestIssuedNumber(organizationId, prefix);
  return formatSequentialId(highestNumber + 1, prefix);
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

    // Number from above the highest id already issued, so nothing written here
    // can collide with one that exists.
    const startingNumber =
      (await getHighestIssuedNumber(organizationId, prefix)) + 1;

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

    // Resume the sequence above the HIGHEST id now issued, never the count of
    // them. The two agree only while numbering is unbroken: deleting a numbered
    // asset drops the count and leaves the maximum where it was, so an
    // organization that has ever deleted one would resume at a number it has
    // already used. `(organizationId, sequentialId)` is unique, so the next
    // asset creation collides — and `createAsset` gives up after three
    // attempts, which a gap of three or more exhausts in front of the user.
    //
    // Re-read rather than deriving from `startingNumber + totalUpdated`: the
    // batch writes are guarded on `sequentialId IS NULL`, so a row filled
    // concurrently is skipped and the arithmetic would drift below the truth.
    const highestIssued = await getHighestIssuedNumber(organizationId, prefix);

    // Three-argument form: `is_called = false` makes the next `nextval` return
    // exactly this value instead of one past it. That is what lets an
    // organization with no assets still be handed id 1.
    await db.$executeRaw`
      SELECT setval(
        'org_' || ${organizationId} || '_asset_sequence',
        ${highestIssued + 1},
        false
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
