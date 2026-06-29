/**
 * "+New asset" Split-Button Dropdown
 *
 * Surfaces the alternative creation paths next to the primary
 * "New asset" CTA on the `/assets` index page without changing the
 * default click target. The main button still navigates to
 * `/assets/new` (no regression for users who don't engage the menu);
 * the caret button next to it opens a Popover with shortcuts to:
 *
 *   - Bulk create from model  → `/assets/new?bulk=1`
 *   - Import from CSV         → `/assets/import` (gated on
 *     `canImportAssets`, mirroring the existing ImportButton gate)
 *
 * Uses Radix Popover (per CLAUDE.md, DropdownMenu is deprecated for
 * new features). Visual styles mirror the existing booking
 * actions-dropdown at
 * `apps/webapp/app/components/booking/actions-dropdown.tsx` so the
 * popover panel looks like the rest of the app's menus.
 *
 * @see {@link file://./../../routes/_layout+/assets._index.tsx} consumer
 */
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { ChevronDownIcon } from "lucide-react";
import { Link } from "react-router";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";

/**
 * @param canImportAssets - Workspace permission flag for CSV import;
 *   when false, the "Import from CSV" menu item is hidden.
 */
export function NewAssetDropdown({
  canImportAssets,
}: {
  canImportAssets: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-stretch" data-test-id="newAssetDropdown">
      <Button
        to="/assets/new"
        role="link"
        aria-label="new asset"
        data-test-id="createNewAsset"
        className="rounded-r-none border-r-0"
      >
        New asset
      </Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            aria-label="More create options"
            // Mirror the main button's height (size=sm → py-2) so the two
            // halves line up; flex-center the caret so the chevron sits in
            // the middle regardless of its intrinsic SVG bounds.
            className={tw(
              "flex items-center justify-center rounded-l-none px-2.5",
              // Rotate the caret 180° while the popover is open to
              // give the user a visual "expanded" affordance — same
              // convention as `actions-dropdown.css` .chev styling.
              open && "[&>svg]:rotate-180"
            )}
            data-test-id="newAssetDropdownTrigger"
          >
            <ChevronDownIcon className="size-4 transition-transform" />
          </Button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="end"
            sideOffset={4}
            // Mirror the field-selector popover styles
            // (`assets-index/advanced-filters/field-selector.tsx:117-121`):
            // no panel padding so rows sit flush against the border,
            // matching the rest of the app's popover menus.
            className="z-[100] w-64 overflow-hidden rounded-md border border-gray-200 bg-white shadow-md"
          >
            <DropdownLink
              to="/assets/new?bulk=1"
              label="Bulk create from model"
              description="Create multiple assets at once from a model"
              onClose={() => setOpen(false)}
            />
            {canImportAssets ? (
              <DropdownLink
                to="/assets/import"
                label="Import from CSV"
                description="Onboard many assets from a spreadsheet"
                onClose={() => setOpen(false)}
              />
            ) : null}
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}

/** Single popover row — label + helper text. Closes the popover on click.
 *
 * Rendered as a plain `<a>` (not the shared `Button`) because the link
 * variant's `primary-700` colour leaks into nested spans and its
 * `border-none p-0` undoes the row padding we want here. Matches the
 * field-selector row styling (px-4 py-2, hover:bg-gray-50, flush
 * edges). */
function DropdownLink({
  to,
  label,
  description,
  onClose,
}: {
  to: string;
  label: string;
  description: string;
  onClose: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClose}
      className="block px-4 py-2 text-left hover:cursor-pointer hover:bg-gray-50"
    >
      <span className="block text-sm font-medium text-gray-900">{label}</span>
      <span className="mt-0.5 block text-xs font-normal text-gray-500">
        {description}
      </span>
    </Link>
  );
}
