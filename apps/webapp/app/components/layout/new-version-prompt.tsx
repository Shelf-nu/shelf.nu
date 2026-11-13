/**
 * New Version Prompt
 *
 * Tells an open tab that a newer build of Shelf is live and offers a reload.
 * A tab keeps running the build it loaded with, so after a deploy its lazy
 * chunks can disappear from the server; reloading moves it onto the new
 * build. The prompt only asks: reloading is always the user's click.
 *
 * Mounted once, in the authenticated layout. From `md` up it sits at the
 * bottom-left of the content area, starting past `--sidebar-width` (set by
 * `SidebarProvider`) so it never covers the sidebar footer, and clear of the
 * toasts and the asset import card in the bottom-right corner. A collapsed
 * sidebar is narrower than that width, so the card only gains margin.
 * On narrow screens it spans the width and stacks above the import card
 * through `--asset-import-card-offset`, the variable the toasts use too.
 *
 * Dismissing hides it for the rest of the browser session for that build
 * only; a later deploy shows it again.
 *
 * @see {@link file://./../../hooks/use-new-version.ts} - state and check triggers
 * @see {@link file://./../shared/reload-app-button.tsx} - the reload control
 * @see {@link file://./../../routes/_layout+/_layout.tsx} - where it is mounted
 */
import { useState } from "react";
import { useBuildVersionChecks, useNewVersion } from "~/hooks/use-new-version";
import { tw } from "~/utils/tw";
import { iconsMap } from "../shared/icons-map";
import { ReloadAppButton } from "../shared/reload-app-button";

/** `sessionStorage` key holding the server build id the user dismissed. */
export const DISMISSED_BUILD_ID_STORAGE_KEY = "shelf:dismissed-build-id";

/** Reads the dismissed build id, or `null` when storage is unavailable. */
function readDismissedBuildId(): string | null {
  try {
    return window.sessionStorage.getItem(DISMISSED_BUILD_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Stores the dismissed build id; a storage error leaves only component state. */
function writeDismissedBuildId(buildId: string) {
  try {
    window.sessionStorage.setItem(DISMISSED_BUILD_ID_STORAGE_KEY, buildId);
  } catch {
    // why: private modes and blocked site data throw here; the prompt still
    // hides through component state for as long as the layout stays mounted
  }
}

/**
 * Card announcing a newer build, with a Reload button and a
 * Dismiss control. Renders nothing while the tab runs the current build,
 * which includes the server render.
 */
export function NewVersionPrompt() {
  useBuildVersionChecks();
  const version = useNewVersion();
  /** Set by Dismiss in this mount; covers storage that throws. */
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(null);

  if (version.status !== "newer") return null;

  // Reading storage during render is safe here: the state is `newer` only
  // after a client-side check, so the server render and hydration never
  // reach this line.
  if (
    version.serverBuildId === dismissedBuildId ||
    version.serverBuildId === readDismissedBuildId()
  ) {
    return null;
  }

  const { serverBuildId } = version;
  const dismiss = () => {
    writeDismissedBuildId(serverBuildId);
    setDismissedBuildId(serverBuildId);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      // why: z-40 matches the asset import card: above page content and the
      // sidebar (z-10), below dialogs and the toast viewport
      className="fixed inset-x-[25px] bottom-[calc(25px+env(safe-area-inset-bottom)+var(--asset-import-card-offset,0px))] z-40 flex items-start gap-3 rounded border border-gray-100 bg-white p-3 shadow-xl md:inset-x-auto md:bottom-[calc(25px+env(safe-area-inset-bottom))] md:left-[calc(var(--sidebar-width)+25px)] md:w-[340px]"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">
          A new version of Shelf is available.
        </p>
        <ReloadAppButton className="mt-2" />
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className={tw(
          "-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        )}
      >
        {iconsMap["x"]}
      </button>
    </div>
  );
}
