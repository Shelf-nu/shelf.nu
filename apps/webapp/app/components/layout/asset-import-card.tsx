/**
 * @file Floating progress card for an asset import.
 *
 * Shown on every authenticated page to the member who started the import, so
 * they can keep working while the background job runs. It follows the import
 * with `useAssetImportStatus`, can be collapsed to its header, and (once the
 * import finished or stopped) dismissed. Collapsed state and the dismissed
 * import id are per-viewer conveniences kept in `localStorage`; the card
 * renders the same without storage.
 *
 * Placement: bottom-right, lifted above the `Toaster` viewport so a toast and
 * the card never overlap. Hidden on `/assets/import/*`, where the status page
 * shows the full view.
 *
 * @see {@link file://./../assets/import-content/import-progress.tsx} `useAssetImportStatus`
 * @see {@link file://./../shared/toast.tsx} Toast viewport that shares the corner
 * @see {@link file://./../../routes/_layout+/_layout.tsx} Renders the card from the layout loader
 */
import { useEffect, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import type { AssetImportStatusPayload } from "~/modules/asset-import/types";
import { useAssetImportStatus } from "../assets/import-content/import-progress";
import { Progress } from "../shared/progress";

/** `localStorage` key holding `"1"` while the card is collapsed. */
const COLLAPSED_KEY = "assetImportCard:collapsed";
/** `localStorage` key holding the id of the import whose outcome was dismissed. */
const DISMISSED_KEY = "assetImportCard:dismissed";

/**
 * Reads a `localStorage` value. Storage can be missing or throw (private
 * windows, blocked site data), so every failure reads as "not set".
 *
 * @param key - Storage key
 * @returns The stored string, or null
 */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Writes a `localStorage` value, ignoring storage failures.
 *
 * @param key - Storage key
 * @param value - Value to store, or null to remove the key
 */
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage is a convenience: the in-memory state still applies.
  }
}

/** Props for {@link AssetImportCard}. */
type AssetImportCardProps = {
  /** The active import from the layout loader. */
  initial: AssetImportStatusPayload;
};

/**
 * Floating import progress card. Renders nothing for imports the viewer did
 * not start and on the import status pages.
 *
 * @param props - See {@link AssetImportCardProps}
 * @returns The card, or null when it should not show
 */
export function AssetImportCard({ initial }: AssetImportCardProps) {
  const { pathname } = useLocation();

  if (!initial.isMine || pathname.startsWith("/assets/import/")) return null;

  return <ImportCardBody initial={initial} />;
}

/**
 * The card itself. Split from {@link AssetImportCard} so polling only starts
 * when the card is actually shown.
 *
 * @param props - See {@link AssetImportCardProps}
 */
function ImportCardBody({ initial }: AssetImportCardProps) {
  const status = useAssetImportStatus(initial.id, initial);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Storage is read after mount so the server render and the first client
  // render agree.
  useEffect(() => {
    setCollapsed(readStorage(COLLAPSED_KEY) === "1");
    setDismissedId(readStorage(DISMISSED_KEY));
  }, []);

  const finished = status.status === "COMPLETED" || status.status === "FAILED";
  if (finished && dismissedId === status.id) return null;

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStorage(COLLAPSED_KEY, next ? "1" : null);
  };

  const dismiss = () => {
    setDismissedId(status.id);
    writeStorage(DISMISSED_KEY, status.id);
  };

  const percent =
    status.totalRows > 0
      ? Math.round((status.processedRows / status.totalRows) * 100)
      : 0;

  const title =
    status.status === "COMPLETED"
      ? "Import complete"
      : status.status === "FAILED"
      ? "Import stopped"
      : "Importing assets";

  // Only the status-dependent text sits in the live region, so screen readers
  // hear status changes and not every row count.
  const outcome =
    status.status === "COMPLETED"
      ? `${status.totalRows} assets imported`
      : status.status === "FAILED"
      ? status.errorMessage ?? "The import stopped."
      : null;

  return (
    <section
      aria-label="Asset import progress"
      className="fixed inset-x-4 bottom-28 z-40 rounded border border-gray-200 bg-white p-4 text-left shadow-xl md:inset-x-auto md:right-4 md:w-80"
    >
      <div className="flex items-center justify-between gap-2">
        <div aria-live="polite" className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{title}</p>
          {!collapsed && outcome ? (
            <p
              className={
                status.status === "FAILED"
                  ? "mt-1 text-sm text-error-600"
                  : "mt-1 text-sm text-success-700"
              }
            >
              {outcome}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={
              collapsed ? "Expand import progress" : "Collapse import progress"
            }
            className="rounded p-1 text-gray-600 hover:bg-gray-100"
          >
            {collapsed ? (
              <ChevronUpIcon className="size-4" aria-hidden="true" />
            ) : (
              <ChevronDownIcon className="size-4" aria-hidden="true" />
            )}
          </button>
          {finished ? (
            <button
              type="button"
              onClick={dismiss}
              aria-label="Dismiss"
              className="rounded p-1 text-gray-600 hover:bg-gray-100"
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="mt-3">
          {finished ? (
            status.warningCount > 0 ? (
              <p className="text-sm text-gray-600">
                {status.warningCount} warnings
              </p>
            ) : null
          ) : (
            <>
              <Progress value={percent} aria-label="Import progress" />
              <p className="mt-2 text-sm text-gray-600">
                {status.processedRows} of {status.totalRows}
              </p>
            </>
          )}
          <Link
            to={`/assets/import/${status.id}`}
            className="mt-2 inline-block text-sm font-semibold text-primary-700 hover:underline"
          >
            View progress
          </Link>
        </div>
      ) : null}
    </section>
  );
}
