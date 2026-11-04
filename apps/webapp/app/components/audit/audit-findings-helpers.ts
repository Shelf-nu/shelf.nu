/**
 * Audit findings helpers
 *
 * Pure functions behind the Findings list on the audit overview: grouping the
 * photos and condition notes recorded during an audit by asset, the count line
 * shown beside each asset, and how many rows the list reveals next as it is
 * scrolled.
 *
 * @see {@link file://./audit-findings.tsx} The component that renders them
 * @see {@link file://./../../routes/_layout+/audits.$auditId.overview.tsx} The page
 */

/** How many asset rows the Findings list reveals at a time. */
export const FINDINGS_BATCH_SIZE = 10;

/** The asset a photo or note was recorded against, if any. */
type FindingAssetLink = {
  auditAsset?: { asset?: { id: string; title: string | null } | null } | null;
};

/** One asset somebody recorded something about, with its photos and notes. */
export type AuditFinding<TImage, TNote> = {
  assetId: string;
  assetName: string;
  images: TImage[];
  notes: TNote[];
};

/**
 * Groups audit photos and condition notes into one entry per asset, sorted by
 * asset name.
 *
 * A note about an asset and a photo of that asset are one observation, so they
 * share an entry. Photos and notes with no asset are skipped: they describe the
 * audit as a whole and are shown separately.
 *
 * @param args.images - Photos taken during the audit
 * @param args.notes - Condition notes written during the audit
 * @returns One entry per asset, alphabetical by asset name
 */
export function groupAuditFindings<
  TImage extends FindingAssetLink,
  TNote extends FindingAssetLink,
>({
  images,
  notes,
}: {
  images: TImage[];
  notes: TNote[];
}): AuditFinding<TImage, TNote>[] {
  const groups = new Map<string, AuditFinding<TImage, TNote>>();

  const groupFor = (asset: { id: string; title: string | null }) => {
    let group = groups.get(asset.id);
    if (!group) {
      group = {
        assetId: asset.id,
        assetName: asset.title || "Unknown",
        images: [],
        notes: [],
      };
      groups.set(asset.id, group);
    }
    return group;
  };

  for (const image of images) {
    const asset = image.auditAsset?.asset;
    if (asset?.id) groupFor(asset).images.push(image);
  }
  for (const note of notes) {
    const asset = note.auditAsset?.asset;
    if (asset?.id) groupFor(asset).notes.push(note);
  }

  return [...groups.values()].sort((a, b) =>
    a.assetName.localeCompare(b.assetName)
  );
}

/**
 * Short count line shown beside an asset in the Findings list.
 *
 * @param photoCount - Photos recorded against the asset
 * @param noteCount - Condition notes recorded against the asset
 * @returns e.g. "2 photos · 1 note", or "" when both are zero
 */
export function findingSummary(photoCount: number, noteCount: number) {
  const parts: string[] = [];
  if (photoCount > 0) {
    parts.push(`${photoCount} ${photoCount === 1 ? "photo" : "photos"}`);
  }
  if (noteCount > 0) {
    parts.push(`${noteCount} ${noteCount === 1 ? "note" : "notes"}`);
  }
  return parts.join(" · ");
}

/**
 * How many rows to show after revealing one more batch.
 *
 * @param current - Rows shown now
 * @param total - Rows there are
 * @param batchSize - Rows revealed per batch
 * @returns The new count, never above `total`
 */
export function nextVisibleCount(
  current: number,
  total: number,
  batchSize: number
) {
  return Math.min(current + batchSize, total);
}
