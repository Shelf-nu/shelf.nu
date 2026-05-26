/**
 * Visibility queries — "The visibility gap" section of the report.
 *
 * Produces these aggregates (keys match website-v2's
 * src/data/state-of-equipment-management-2026.ts sectionStats.visibility):
 *
 *   median_assets_per_workspace             — median Asset count per eligible Organization
 *   median_users_per_workspace              — median UserOrganization count per Org
 *   pct_assets_with_active_custody          — % of Assets with a current Custody row
 *   vis_assets_with_location                — % of Assets with locationId IS NOT NULL
 *   vis_assets_with_category                — % of Assets with categoryId IS NOT NULL
 *   vis_assets_with_custom_fields           — % of Assets with at least one populated custom field
 *   vis_median_fields_per_workspace         — median configured CustomField count per Org
 *   vis_top_categories                      — top 5 Category names by Asset count, with %
 *
 * @see ../README.md — implementation workflow
 * @see ../anonymize.ts — use reportable() to wrap every numerical aggregate
 */

import type { ExtendedPrismaClient } from "@shelf/database";
import { notImplementedAggregate } from "../anonymize";
import type { ExtractorContext } from "../context";
import type { QueryResult } from "../output-schema";

export async function runVisibilityQueries(
    _db: ExtendedPrismaClient,
    _ctx: ExtractorContext,
): Promise<QueryResult> {
    // TODO: implement against the eligible cohort in _ctx.eligibleOrgIds.
    //
    // Implementation guidance:
    // - For median: pull per-Org counts, sort, pick the middle value.
    //   Prisma doesn't have a native median aggregator. Either compute in
    //   JS after a `groupBy` or use a raw query.
    // - For "% with active custody":
    //     numerator = Asset.count({ where: { Custody: { isNot: null }, organizationId: { in: ids } } })
    //     denominator = Asset.count({ where: { organizationId: { in: ids } } })
    //   Restrict denominator to Assets that existed at end of window
    //   (createdAt <= dataWindowEnd).
    // - For % with location / category: similar pattern with field-not-null where.
    // - For top categories: groupBy({ by: ['categoryId'], _count }), join names
    //   via a second query, restrict to categories with >= --min-cohort-size
    //   workspaces represented (avoid leaking a niche category that only one
    //   workspace uses).
    // - Custom-field population requires hitting AssetCustomFieldValue rows.
    //
    // Every numerical return goes through `reportable({ ... })` to attach the
    // k-anonymity check + sig-fig rounding.

    return {
        median_assets_per_workspace: notImplementedAggregate({
            key: "median_assets_per_workspace",
            label: "Median assets per workspace",
        }),
        median_users_per_workspace: notImplementedAggregate({
            key: "median_users_per_workspace",
            label: "Median users per workspace",
        }),
        pct_assets_with_active_custody: notImplementedAggregate({
            key: "pct_assets_with_active_custody",
            label: "Of assets have an active custodian assigned",
            unit: "%",
        }),
        vis_assets_with_location: notImplementedAggregate({
            key: "vis_assets_with_location",
            label: "Of assets have a current location assigned",
            unit: "%",
        }),
        vis_assets_with_category: notImplementedAggregate({
            key: "vis_assets_with_category",
            label: "Of assets are categorized",
            unit: "%",
        }),
        vis_assets_with_custom_fields: notImplementedAggregate({
            key: "vis_assets_with_custom_fields",
            label: "Of assets have one or more custom fields populated",
            unit: "%",
        }),
        vis_median_fields_per_workspace: notImplementedAggregate({
            key: "vis_median_fields_per_workspace",
            label: "Median custom fields configured per workspace",
        }),
        vis_top_categories: notImplementedAggregate({
            key: "vis_top_categories",
            label: "Top asset categories across the platform",
        }),
    };
}
