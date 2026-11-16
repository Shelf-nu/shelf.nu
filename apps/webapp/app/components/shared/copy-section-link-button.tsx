/**
 * Copy Section Link Button
 *
 * Small link icon beside a section heading. Clicking it copies the page URL
 * with the section's hash (for example `.../settings/bookings#automation`),
 * points the address bar at the section, and shows a check mark for a moment.
 *
 * @see {@link file://./card.tsx} - `CardTitle` renders it for anchored cards
 */
import { useEffect, useState } from "react";
import { Check, Link as LinkIcon } from "lucide-react";
import { replaceUrlHash, sectionUrl } from "~/utils/section-anchor";
import { tw } from "~/utils/tw";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

/** How long the "copied" check mark stays, in ms. */
const COPIED_FEEDBACK_MS = 2000;

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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timeout);
  }, [copied]);

  async function copyLink() {
    replaceUrlHash(anchorId);
    try {
      await navigator.clipboard.writeText(
        sectionUrl(anchorId, window.location)
      );
      setCopied(true);
    } catch {
      // The Clipboard API rejects outside a secure context or without
      // permission. The address bar already shows the link, so it can be
      // copied from there.
    }
  }

  return (
    // Its own provider, so the button works in any card, including ones
    // rendered outside the app root (component tests, for one).
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={copyLink}
            aria-label={`Copy link to ${sectionTitle}`}
            className={tw(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500",
              copied
                ? "text-success-600"
                : "text-gray-400 hover:bg-gray-50 hover:text-gray-700"
            )}
          >
            {copied ? (
              <Check className="size-4" aria-hidden />
            ) : (
              <LinkIcon className="size-4" aria-hidden />
            )}
          </button>
        </TooltipTrigger>
        {/* Announces the copy; the button keeps the same name throughout. */}
        <span className="sr-only" aria-live="polite">
          {copied ? "Link copied" : ""}
        </span>
        <TooltipContent side="top" className="px-2 py-1 text-xs">
          {copied ? "Link copied" : "Copy link to this section"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
