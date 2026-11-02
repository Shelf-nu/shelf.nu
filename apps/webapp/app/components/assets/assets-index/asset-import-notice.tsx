/**
 * @file One-line notice on the assets index while an import is running.
 *
 * Shown to every member of the workspace so nobody is surprised by assets
 * appearing on their own. The layout renders it above the page content and
 * hands it the layout loader's `activeAssetImport`, so the assets index
 * loader gains no query. It shows only on `/assets`. While the import is
 * active and the tab is visible it polls `GET /api/asset-imports/active` so the
 * count follows the import; once the import is no longer active the notice
 * hides and the page revalidates once so the new assets appear.
 *
 * @see {@link file://./../../layout/asset-import-card.tsx} Floating card for the starter
 * @see {@link file://./../../../routes/api+/asset-imports.active.ts} Polled endpoint
 * @see {@link file://./../../../routes/_layout+/_layout.tsx} Loader and render site
 */
import { useEffect, useRef, useState } from "react";
import { useLocation, useRevalidator } from "react-router";
import useApiQuery from "~/hooks/use-api-query";
import { formatCount } from "~/modules/asset-import/format";
import type { AssetImportNoticePayload } from "~/modules/asset-import/types";
import {
  isActiveStatus,
  usePollWhileVisible,
} from "../import-content/import-progress";

/** Shape of the active import endpoint's response. */
type ActiveImportResponse = {
  import?: AssetImportNoticePayload | null;
  error?: unknown;
};

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
    !isActiveStatus(activeAssetImport.status)
  ) {
    return null;
  }

  return <LiveImportNotice initial={activeAssetImport} />;
}

/**
 * The notice itself. Split from {@link AssetImportNotice} so polling only
 * runs on the assets index while an import is active.
 *
 * @param props.initial - The active import from the layout loader
 * @returns The notice while the import is active, otherwise null
 */
function LiveImportNotice({ initial }: { initial: AssetImportNoticePayload }) {
  const { revalidate } = useRevalidator();
  // The polled value is tagged with the `initial` it was polled against, so a
  // newer loader payload wins over an older poll.
  const [polled, setPolled] = useState<{
    base: AssetImportNoticePayload;
    value: AssetImportNoticePayload | null;
  } | null>(null);
  const current = polled && polled.base === initial ? polled.value : initial;
  const active = !!current && isActiveStatus(current.status);

  const { refetch } = useApiQuery<ActiveImportResponse>({
    api: "/api/asset-imports/active",
    enabled: active,
    onSuccess: (response) => {
      // An error response carries no `import` key; keep the last value.
      if (response.error || !("import" in response)) return;
      setPolled({ base: initial, value: response.import ?? null });
    },
  });

  usePollWhileVisible(refetch, active);

  // Revalidate once when the import stops being active, so the assets list
  // and the layout's import payload catch up with what the import created.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active) void revalidate();
    wasActive.current = active;
  }, [active, revalidate]);

  if (!current || !active) return null;

  // Not a live region: the count changes on every poll and would be
  // announced each time.
  return (
    <div className="mx-4 mt-4 rounded border border-primary-200 bg-primary-25 p-3 text-sm text-primary-700">
      An import is running ({formatCount(current.processedRows)} of{" "}
      {formatCount(current.totalRows)}). New assets will keep appearing.
    </div>
  );
}
