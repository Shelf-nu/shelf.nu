import type { Prisma } from "@prisma/client";

// why: `satisfies` (instead of `: Prisma.KitInclude`) preserves the literal
// type so downstream `getKit` / `MergeInclude` consumers can see the deep
// shape (e.g. `assetKits.select.asset.select.valuation`). A widening
// annotation here collapses the union and forces consumers into casts.
const KIT_OVERVIEW_BARCODES_FIELDS = {
  barcodes: {
    select: {
      id: true,
      type: true,
      value: true,
    },
  },
} satisfies Prisma.KitInclude;

const KIT_OVERVIEW_BASE_FIELDS = {
  assetKits: {
    select: {
      asset: { select: { valuation: true } },
    },
  },
  qrCodes: {
    select: {
      id: true,
    },
  },
  category: {
    select: {
      id: true,
      name: true,
      color: true,
    },
  },
  location: true,
} satisfies Prisma.KitInclude;

/**
 * Kit-overview Prisma include. Two literal variants — with or without
 * barcodes — so callers preserve the deep shape end-to-end.
 *
 * @param canUseBarcodes - When true, include the kit's barcodes relation
 */
export function getKitOverviewFields(
  canUseBarcodes: true
): typeof KIT_OVERVIEW_BASE_FIELDS & typeof KIT_OVERVIEW_BARCODES_FIELDS;
export function getKitOverviewFields(
  canUseBarcodes?: false
): typeof KIT_OVERVIEW_BASE_FIELDS;
// why: runtime `boolean` callers (e.g. when the value comes from a
// permission flag) get the merged shape with `barcodes` typed as
// optional — at runtime the field is absent when the flag is false.
export function getKitOverviewFields(
  canUseBarcodes: boolean
): typeof KIT_OVERVIEW_BASE_FIELDS &
  Partial<typeof KIT_OVERVIEW_BARCODES_FIELDS>;
export function getKitOverviewFields(canUseBarcodes: boolean = false) {
  return canUseBarcodes
    ? { ...KIT_OVERVIEW_BASE_FIELDS, ...KIT_OVERVIEW_BARCODES_FIELDS }
    : KIT_OVERVIEW_BASE_FIELDS;
}

// Keep the original for backward compatibility
export const KIT_OVERVIEW_FIELDS = getKitOverviewFields(true);
