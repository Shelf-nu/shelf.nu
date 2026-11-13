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
 * It cannot be dismissed: it stays until the tab reloads onto the new build.
 *
 * @see {@link file://./../../hooks/use-new-version.ts} - state and check triggers
 * @see {@link file://./../shared/reload-app-button.tsx} - the reload control
 * @see {@link file://./../../routes/_layout+/_layout.tsx} - where it is mounted
 */
import { RefreshCwIcon } from "lucide-react";
import { useBuildVersionChecks, useNewVersion } from "~/hooks/use-new-version";
import {
  ReloadAppButton,
  UNSAVED_CHANGES_RELOAD_HINT,
  useHasUnsavedForms,
} from "../shared/reload-app-button";

/**
 * Banner announcing a newer build: a title, one line on what to do, a small
 * Reload button beside them. While a tracked form is dirty, the line asks to save first. Renders nothing while the tab runs the
 * current build, which includes the server render.
 */
export function NewVersionPrompt() {
  useBuildVersionChecks();
  const version = useNewVersion();
  const hasUnsavedForms = useHasUnsavedForms();
  if (version.status !== "newer") return null;

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
      </div>
    </div>
  );
}
