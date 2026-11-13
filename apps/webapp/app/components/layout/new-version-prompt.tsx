/**
 * New Version Prompt
 *
 * Tells an open tab that a newer build of Shelf is live and offers a reload.
 * A tab keeps running the build it loaded with, so after a deploy its lazy
 * chunks can disappear from the server; reloading moves it onto the new
 * build. The prompt only asks: reloading is always the user's click.
 *
 * Mounted once, as the first child of the content area (`SidebarInset`, the
 * element that scrolls), as a banner that sticks to its top. It stays in view
 * while the page scrolls, pushes the page down instead of covering it, and
 * never reaches over the sidebar or the page header's actions.
 *
 * Dismissing hides it for the rest of the browser session for that build
 * only; a later deploy shows it again.
 *
 * @see {@link file://./../../hooks/use-new-version.ts} - state and check triggers
 * @see {@link file://./../shared/reload-app-button.tsx} - the reload control
 * @see {@link file://./../../routes/_layout+/_layout.tsx} - where it is mounted
 */
import { useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { useBuildVersionChecks, useNewVersion } from "~/hooks/use-new-version";
import { tw } from "~/utils/tw";
import { iconsMap } from "../shared/icons-map";
import {
  ReloadAppButton,
  UNSAVED_CHANGES_RELOAD_HINT,
  useHasUnsavedForms,
} from "../shared/reload-app-button";

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
 * Banner announcing a newer build: a title, one line on what to do, a small
 * Reload button beside them and a Dismiss control. While a tracked form is
 * dirty, the line asks to save first. Renders nothing while the tab runs the
 * current build, which includes the server render.
 */
export function NewVersionPrompt() {
  useBuildVersionChecks();
  const version = useNewVersion();
  const hasUnsavedForms = useHasUnsavedForms();
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
      // why: z-30 keeps the banner above the page it scrolls over, below the
      // sidebar sheet, dialogs and toasts
      className="sticky top-0 z-30 -mx-4 border-b border-primary-100 bg-primary-25 px-4 py-2.5"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-700"
        >
          <RefreshCwIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 text-sm md:flex md:items-baseline md:gap-2">
          <p className="font-semibold text-gray-900">New version available</p>
          <p className="text-gray-600">
            {hasUnsavedForms
              ? UNSAVED_CHANGES_RELOAD_HINT
              : "Reload to get the latest version of Shelf."}
          </p>
        </div>
        <ReloadAppButton size="xs" className="shrink-0" />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className={tw(
            "flex size-8 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-primary-50 hover:text-gray-700",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          )}
        >
          {iconsMap["x"]}
        </button>
      </div>
    </div>
  );
}
