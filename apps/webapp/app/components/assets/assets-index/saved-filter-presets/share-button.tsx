import { Users } from "lucide-react";
import { useFetcher } from "react-router";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import type { NormalizedPreset } from "./preset-list-item";

/**
 * Publishes a saved filter to the workspace, or takes it back.
 *
 * Sits beside the star so the shared state is readable without hovering: an
 * orange icon means the whole workspace can apply this view. Like the star it
 * updates optimistically and reverts if the server refuses.
 *
 * Render it only for a user who holds `assetIndexSettings:update`; everyone
 * else reads the state off the row's "Shared by …" line.
 *
 * @param preset - The preset to share or unshare.
 */
export function ShareButton({ preset }: { preset: NormalizedPreset }) {
  // Unique fetcher key per preset so several rows can be toggled at once
  const shareFetcher = useFetcher({ key: `share-preset-${preset.id}` });

  const isSharing =
    isFormProcessing(shareFetcher.state) &&
    shareFetcher.formData?.get("presetId") === preset.id;

  // Optimistic shared state: use formData while in flight, else the server's
  const optimisticShared = isSharing
    ? shareFetcher.formData?.get("shared") === "true"
    : preset.shared;

  const nextShared = !preset.shared;

  return (
    <shareFetcher.Form method="post">
      <input type="hidden" name="intent" value="share-preset" />
      <input type="hidden" name="presetId" value={preset.id} />
      <input type="hidden" name="shared" value={String(nextShared)} />
      <button
        type="submit"
        aria-pressed={optimisticShared}
        className={tw(
          "mt-0.5 hover:text-primary-600",
          optimisticShared ? "text-primary-600" : "text-gray-400"
        )}
        title={
          optimisticShared
            ? "Stop sharing with workspace"
            : "Share with workspace"
        }
        // why: keep the submit from bubbling into the row's apply handler,
        // which would close the popover on every toggle
        onClick={(e) => {
          e.stopPropagation();

          // Someone else's shared view disappears for everyone when retired,
          // so make that one deliberate. Your own is one click to undo.
          if (!preset.isOwn && !confirm(`Stop sharing "${preset.name}"?`)) {
            e.preventDefault();
          }
        }}
      >
        <Users className="size-4" />
      </button>
    </shareFetcher.Form>
  );
}
