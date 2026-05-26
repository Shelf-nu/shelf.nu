/**
 * Eligible-workspace cohort builder.
 *
 * Applies the report's published inclusion criteria:
 * - `Organization.type = TEAM` (Personal workspaces excluded)
 * - `Organization.workspaceDisabled = false`
 * - Owner `User.deletedAt IS NULL`
 * - Workspace ID NOT in internal allowlist
 * - Workspace tracked >= minAssets assets during the data window
 *
 * The returned `eligibleOrgIds` array is the single cohort every downstream
 * query restricts to. Per-query feature-enabled subsetting (e.g. Audits-
 * enabled workspaces only) happens inside each query module.
 *
 * @see ../methodology.md — published methodology
 * @see ./anonymize.ts — k-anonymity floor applied at output time
 */

import { readFile } from "node:fs/promises";
import type { ExtendedPrismaClient } from "@shelf/database";

import type { ExtractorCliOptions } from "./cli";

/**
 * Diagnostic counts emitted alongside the cohort. Useful for the data team
 * to verify their cohort matches expectations before they cite numbers.
 */
export interface CohortSummary {
    /** Total Organizations matching the basic inclusion criteria. */
    totalEligible: number;
    /** Of those, how many were excluded by the asset-count threshold. */
    excludedByAssetCount: number;
    /** Of those, how many were excluded by the internal allowlist. */
    excludedByAllowlist: number;
    /** Final cohort size after all filters. */
    finalCohortSize: number;
    /** Distinct country count, approximated from owner locale if available. */
    countryCount: number;
    /** Total assets tracked across the final cohort during the window. */
    totalAssets: number;
    /** ISO 8601 timestamp the cohort was computed at. */
    computedAt: string;
}

/**
 * Returns the array of eligible Organization IDs, plus a diagnostic summary
 * that the orchestrator includes in the output JSON for transparency.
 */
export async function buildEligibleCohort(
    db: ExtendedPrismaClient,
    options: ExtractorCliOptions,
): Promise<{ orgIds: string[]; summary: CohortSummary }> {
    const allowlist = await loadAllowlist(options.internalAllowlistPath);

    // 1. Baseline eligibility query — the schema-level filters that we can
    // express directly in a Prisma where clause. The asset-count threshold
    // is applied in step 2 because Prisma doesn't support a `_count`
    // comparison inside the where clause cleanly.
    const baselineOrgs = await db.organization.findMany({
        where: {
            type: "TEAM",
            workspaceDisabled: false,
            user: {
                deletedAt: null,
            },
        },
        select: {
            id: true,
            _count: {
                select: {
                    assets: {
                        where: {
                            createdAt: { lte: options.dataWindowEnd },
                        },
                    },
                },
            },
        },
    });

    // 2. Apply asset-count threshold and allowlist exclusion.
    let excludedByAssetCount = 0;
    let excludedByAllowlist = 0;
    const finalOrgIds: string[] = [];

    for (const org of baselineOrgs) {
        if (allowlist.has(org.id)) {
            excludedByAllowlist += 1;
            continue;
        }
        if (org._count.assets < options.minAssets) {
            excludedByAssetCount += 1;
            continue;
        }
        finalOrgIds.push(org.id);
    }

    const totalAssets = baselineOrgs
        .filter((o) => !allowlist.has(o.id) && o._count.assets >= options.minAssets)
        .reduce((sum, o) => sum + o._count.assets, 0);

    // 3. Country count — placeholder. The DB doesn't store country directly;
    // a real implementation would derive from `UserBusinessIntel.country`,
    // billing country, or Stripe customer country. For v1 we report 0
    // here and the data team fills in once they decide on the source.
    const countryCount = 0;

    return {
        orgIds: finalOrgIds,
        summary: {
            totalEligible: baselineOrgs.length,
            excludedByAssetCount,
            excludedByAllowlist,
            finalCohortSize: finalOrgIds.length,
            countryCount,
            totalAssets,
            computedAt: new Date().toISOString(),
        },
    };
}

/**
 * Load the internal allowlist JSON file. The file format is a plain JSON
 * array of organization IDs to exclude (Shelf staff workspaces, demo orgs,
 * support workspaces). Missing file is treated as an empty allowlist — the
 * data team is expected to maintain the real list.
 */
async function loadAllowlist(path: string): Promise<Set<string>> {
    try {
        const contents = await readFile(path, "utf8");
        const parsed = JSON.parse(contents);
        if (!Array.isArray(parsed)) {
            throw new Error(
                `Internal allowlist at ${path} must be a JSON array of org IDs. Got: ${typeof parsed}`,
            );
        }
        if (parsed.some((v) => typeof v !== "string")) {
            throw new Error(
                `Internal allowlist at ${path} must contain only string IDs.`,
            );
        }
        return new Set<string>(parsed);
    } catch (err) {
        // ENOENT is benign — we treat a missing file as an empty allowlist
        // so the script runs out of the box for the data team's first run.
        if (
            err instanceof Error &&
            "code" in err &&
            (err as { code: string }).code === "ENOENT"
        ) {
            console.warn(
                `\nWarning: internal allowlist at ${path} not found. Proceeding with empty allowlist.\n` +
                    "Production runs MUST provide a populated allowlist excluding Shelf staff and demo workspaces.\n",
            );
            return new Set<string>();
        }
        throw err;
    }
}
