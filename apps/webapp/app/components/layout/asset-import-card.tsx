/**
 * @file Floating progress card for an asset import.
 *
 * Shown on every authenticated page to the member who started the import, so
 * they can keep working while the background job runs. It follows the import
 * with `useAssetImportStatus`, can be collapsed to its header, and can be
 * closed in every state; closing hides it for that import, whose progress
 * stays reachable from the assets index notice and the import pages. A
 * finished import closes itself `AUTO_DISMISS_MS` after it is shown finished,
 * paused while the card is hovered or holds focus. Collapsed state and the
 * dismissed import id are per-viewer conveniences kept in `localStorage`; the
 * card renders the same without storage.
 *
 * Looks like a toast (`Toaster`): white card, round status icon. Placement:
 * bottom-right with the toast viewport's 25px inset, lifted above that
 * viewport so a toast and the card never overlap. Hidden on `/assets/import`
 * and `/assets/import/*`, where the upload and status pages show the import
 * themselves.
 *
 * @see {@link file://./../assets/import-content/import-progress.tsx} `useAssetImportStatus`
 * @see {@link file://./../shared/toast.tsx} Toast viewport that shares the corner
 * @see {@link file://./../../routes/_layout+/_layout.tsx} Renders the card from the layout loader
 */
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { useLocation } from "react-router";
import { formatAssetCount, formatCount } from "~/modules/asset-import/format";
import type { AssetImportStatusPayload } from "~/modules/asset-import/types";
import { tw } from "~/utils/tw";
import { useAssetImportStatus } from "../assets/import-content/import-progress";
import { Button } from "../shared/button";
import { iconsMap } from "../shared/icons-map";
import { Progress } from "../shared/progress";
import { Spinner } from "../shared/spinner";

/** `localStorage` key holding `"1"` while the card is collapsed. */
const COLLAPSED_KEY = "assetImportCard:collapsed";
/** `localStorage` key holding the id of the import the viewer closed the card for. */
const DISMISSED_KEY = "assetImportCard:dismissed";
/** How long a finished import stays on screen before the card closes itself. */
export const AUTO_DISMISS_MS = 10_000;

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
 * Whether `pathname` is the upload page or one of the import status pages,
 * which show the import themselves. `/assets/import-update` is a different
 * page and keeps the card.
 *
 * @param pathname - The current location's pathname
 */
function isImportPage(pathname: string) {
  return (
    pathname === "/assets/import" || pathname.startsWith("/assets/import/")
  );
}

/**
 * Floating import progress card. Renders nothing for imports the viewer did
 * not start, on the import pages, and once the viewer closed it for this
 * import. A closed card stops polling.
 *
 * @param props - See {@link AssetImportCardProps}
 * @returns The card, or null when it should not show
 */
export function AssetImportCard({ initial }: AssetImportCardProps) {
  const { pathname } = useLocation();
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  // Storage is read after mount so the server render and the first client
  // render agree.
  useEffect(() => {
    setDismissedId(readStorage(DISMISSED_KEY));
  }, []);

  if (!initial.isMine || isImportPage(pathname) || dismissedId === initial.id) {
    return null;
  }

  const dismiss = () => {
    setDismissedId(initial.id);
    writeStorage(DISMISSED_KEY, initial.id);
  };

  return <ImportCardBody initial={initial} onDismiss={dismiss} />;
}

/** Props for {@link ImportCardBody}. */
type ImportCardBodyProps = AssetImportCardProps & {
  /** Hides the card for this import and remembers that it was closed. */
  onDismiss: () => void;
};

/** Toast icon circle colours, matching the `Toaster` variants. */
const ICON_VARIANTS = {
  primary: tw("border-primary-50 bg-primary-100 text-primary"),
  success: tw("border-success-50 bg-success-100 text-success-600"),
  error: tw("border-error-50 bg-error-100 text-error-600"),
};

/** Shared look of the header's icon buttons. */
const ICON_BUTTON_CLASS = tw(
  "flex size-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
);

/**
 * The card itself. Split from {@link AssetImportCard} so polling only starts
 * when the card is actually shown.
 *
 * @param props - See {@link ImportCardBodyProps}
 */
function ImportCardBody({ initial, onDismiss }: ImportCardBodyProps) {
  const status = useAssetImportStatus(initial.id, initial);
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  // The timer calls the newest callback without restarting on every render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    setCollapsed(readStorage(COLLAPSED_KEY) === "1");
  }, []);

  const finished = status.status === "COMPLETED" || status.status === "FAILED";
  const paused = hovered || focusWithin;

  // A finished card closes itself, unless the viewer is reading or using it.
  // Leaving the card restarts the full delay.
  useEffect(() => {
    if (!finished || paused) return;
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [finished, paused]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    writeStorage(COLLAPSED_KEY, next ? "1" : null);
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
      ? `${formatAssetCount(status.totalRows)} imported`
      : status.status === "FAILED"
      ? status.errorMessage ?? "The import stopped."
      : null;

  let icon: ReactNode;
  let iconVariant: keyof typeof ICON_VARIANTS;
  if (status.status === "COMPLETED") {
    icon = iconsMap.check;
    iconVariant = "success";
  } else if (status.status === "FAILED") {
    icon = iconsMap.x;
    iconVariant = "error";
  } else {
    icon = <Spinner className="size-4" />;
    iconVariant = "primary";
  }

  return (
    <section
      aria-label="Asset import progress"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        // Focus moving between the card's own controls keeps it paused.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusWithin(false);
        }
      }}
      className="fixed inset-x-[25px] bottom-28 z-40 flex gap-4 rounded border border-gray-100 bg-white p-3 text-left shadow-xl md:inset-x-auto md:right-[25px] md:w-[340px]"
    >
      <div
        aria-hidden="true"
        className={tw(
          ICON_VARIANTS[iconVariant],
          "flex size-10 shrink-0 items-center justify-center rounded-full border-[6px]"
        )}
      >
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div aria-live="polite" className="min-w-0 pt-1">
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
          <div className="-mr-1 -mt-1 flex shrink-0 items-center">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-expanded={!collapsed}
              aria-label={
                collapsed
                  ? "Expand import progress"
                  : "Collapse import progress"
              }
              className={ICON_BUTTON_CLASS}
            >
              {collapsed ? (
                <ChevronUpIcon className="size-4" aria-hidden="true" />
              ) : (
                <ChevronDownIcon className="size-4" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close import progress"
              className={ICON_BUTTON_CLASS}
            >
              <XIcon className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {!collapsed ? (
          <div className="mt-2">
            {finished ? (
              status.warningCount > 0 ? (
                <p className="text-sm text-gray-600">
                  {formatCount(status.warningCount)}{" "}
                  {status.warningCount === 1 ? "warning" : "warnings"}
                </p>
              ) : null
            ) : (
              <>
                <Progress value={percent} aria-label="Import progress" />
                <p className="mt-2 text-sm text-gray-600">
                  {formatCount(status.processedRows)} of{" "}
                  {formatCount(status.totalRows)}
                </p>
              </>
            )}
            <Button
              to={`/assets/import/${status.id}`}
              variant="secondary"
              size="xs"
              className="mt-3"
            >
              View progress
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
