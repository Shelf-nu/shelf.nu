/**
 * Copy Section Link Button
 *
 * Small link icon beside a section heading. Clicking it copies the page URL
 * with the section's hash (for example `.../settings/bookings#automation`),
 * points the address bar at the section, and shows for a moment whether the
 * copy worked. It relies on the app-level `TooltipProvider` in `root.tsx`.
 *
 * @see {@link file://./card.tsx} - `CardTitle` renders it for anchored cards
 */
import { useEffect, useState } from "react";
import { AlertCircle, Check, Link as LinkIcon } from "lucide-react";
import { replaceUrlHash, sectionUrl } from "~/utils/section-anchor";
import { tw } from "~/utils/tw";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** How long the copy result stays on the button, in ms. */
const FEEDBACK_MS = 2000;

/** What the last click did: nothing yet, copied, or refused by the browser. */
type CopyResult = "idle" | "copied" | "failed";

/** Tooltip and screen-reader text for each result. */
const RESULT_TEXT: Record<CopyResult, string> = {
  idle: "Copy link to this section",
  copied: "Link copied",
  failed: "Couldn't copy. The link is in the address bar.",
};

/**
 * Button that copies a link to one section of the current page.
 *
 * @param props.anchorId - The section's id
 * @param props.sectionTitle - The section's heading, used in the button's
 *   accessible name so each button on a page says where it links
 */
export function CopySectionLinkButton({
  anchorId,
  sectionTitle,
}: {
  anchorId: string;
  sectionTitle: string;
}) {
  const [result, setResult] = useState<CopyResult>("idle");

  useEffect(() => {
    if (result === "idle") return;
    const timeout = setTimeout(() => setResult("idle"), FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [result]);

  async function copyLink() {
    // The address bar points at the section either way, so a refused copy
    // still leaves the link one select-and-copy away.
    replaceUrlHash(anchorId);
    try {
      await navigator.clipboard.writeText(
        sectionUrl(anchorId, window.location)
      );
      setResult("copied");
    } catch {
      // The Clipboard API rejects outside a secure context or without
      // permission.
      setResult("failed");
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={copyLink}
          aria-label={`Copy link to ${sectionTitle}`}
          className={tw(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
            result === "copied" && "text-success-600",
            result === "failed" && "text-error-500",
            result === "idle" &&
              "text-gray-400 hover:bg-gray-50 hover:text-gray-700"
          )}
        >
          {result === "copied" ? (
            <Check className="size-4" aria-hidden />
          ) : result === "failed" ? (
            <AlertCircle className="size-4" aria-hidden />
          ) : (
            <LinkIcon className="size-4" aria-hidden />
          )}
        </button>
      </TooltipTrigger>
      {/* Announces the result; the button keeps the same name throughout. */}
      <span className="sr-only" aria-live="polite">
        {result === "idle" ? "" : RESULT_TEXT[result]}
      </span>
      <TooltipContent side="top" className="px-2 py-1 text-xs">
        {RESULT_TEXT[result]}
      </TooltipContent>
    </Tooltip>
  );
}
