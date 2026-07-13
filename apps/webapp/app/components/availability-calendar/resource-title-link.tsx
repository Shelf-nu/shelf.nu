/**
 * Resource Title Link
 *
 * Renders the clickable asset/kit title shown in the left-hand label column of
 * the availability (resource-timeline) calendar. The title truncates to a
 * single line with an ellipsis when it overflows the fixed-width column, and a
 * tooltip (surfaced on hover and keyboard focus) reveals the full title so it
 * is never permanently hidden.
 *
 * Shared by the assets and kits availability views so the markup, truncation,
 * tooltip, and focus styling stay identical across both surfaces.
 *
 * @see {@link file://./availability-calendar.tsx}
 * @see {@link file://./../assets/assets-index/assets-list.tsx}
 * @see {@link file://./../../routes/_layout+/kits._index.tsx}
 */
import { Link } from "react-router";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";

/** Props for {@link ResourceTitleLink}. */
type ResourceTitleLinkProps = {
  /** Destination path for the asset/kit detail page (opened in a new tab). */
  to: string;
  /** Full title, used both as the visible (truncated) label and tooltip text. */
  title: string;
};

/**
 * A truncating, tooltip-backed title link for availability-calendar rows.
 *
 * The detail page opens in a new tab (the calendar is a working surface users
 * don't want to navigate away from). The visible label truncates with an
 * ellipsis; the Radix tooltip fires on hover and on keyboard focus, and a
 * `focus-visible` ring keeps the link accessible to keyboard users.
 *
 * @param props - See {@link ResourceTitleLinkProps}.
 * @returns The tooltip-wrapped, truncating title link.
 */
export function ResourceTitleLink({ to, title }: ResourceTitleLinkProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            to={to}
            target="_blank"
            rel="noreferrer"
            className="block truncate rounded-sm text-left font-medium text-gray-900 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
          >
            {title}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[400px]">
          <p className="text-sm">{title}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
