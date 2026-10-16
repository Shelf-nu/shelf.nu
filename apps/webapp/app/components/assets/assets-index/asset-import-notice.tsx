/**
 * @file One-line notice on the assets index while an import is running.
 *
 * Shown to every member of the workspace so nobody is surprised by assets
 * appearing on their own. The layout renders it above the page content and
 * hands it the layout loader's `activeAssetImport`, so the assets index
 * loader gains no query. It shows only on `/assets` and refreshes with normal
 * navigation rather than polling.
 *
 * @see {@link file://./../../layout/asset-import-card.tsx} Floating card for the starter
 * @see {@link file://./../../../routes/_layout+/_layout.tsx} Loader and render site
 */
import { useLocation } from "react-router";
import { formatCount } from "~/modules/asset-import/format";
import type { AssetImportNoticePayload } from "~/modules/asset-import/types";

/** Props for {@link AssetImportNotice}. */
type AssetImportNoticeProps = {
  /** The active import from the layout loader, if any. */
  activeAssetImport: AssetImportNoticePayload | null | undefined;
};

/**
 * Renders the running-import notice, or nothing when no import is queued or
 * running or the current page is not the assets index.
 *
 * @param props - See {@link AssetImportNoticeProps}
 * @returns The notice, or null
 */
export function AssetImportNotice({
  activeAssetImport,
}: AssetImportNoticeProps) {
  const { pathname } = useLocation();

  if (
    (pathname !== "/assets" && pathname !== "/assets/") ||
    !activeAssetImport ||
    (activeAssetImport.status !== "QUEUED" &&
      activeAssetImport.status !== "RUNNING")
  ) {
    return null;
  }

  return (
    <div
      role="status"
      className="mx-4 mt-4 rounded border border-primary-200 bg-primary-25 p-3 text-sm text-primary-700"
    >
      An import is running ({formatCount(activeAssetImport.processedRows)} of{" "}
      {formatCount(activeAssetImport.totalRows)}). New assets will keep
      appearing.
    </div>
  );
}
