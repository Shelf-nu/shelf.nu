import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { AssetImage } from "~/components/assets/asset-image/component";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import useApiQuery from "~/hooks/use-api-query";

/**
 * AssetsListComponent for Markdoc
 *
 * This component renders an interactive asset count that shows a popover
 * with asset details when clicked. Used in booking activity notes.
 *
 * Usage in markdown content:
 * {% assets_list count=3 ids="id1,id2,id3" action="added" /%}
 */

interface AssetsListComponentProps {
  count: number;
  ids: string;
  action: string;
}

interface Asset {
  id: string;
  title: string;
  mainImage?: string;
}

export function AssetsListComponent({
  count,
  ids,
  action: _action,
}: AssetsListComponentProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Use useApiQuery hook for fetching assets
  // For single assets, fetch immediately to show direct link with name
  // For multiple assets, only fetch when popover opens
  const searchParams = new URLSearchParams({ ids });
  const { data, isLoading, error } = useApiQuery<{ assets: Asset[] }>({
    api: "/api/assets",
    searchParams,
    enabled: count === 1 || isOpen,
  });

  // Handle popover open/close
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  // Determine the text to display
  const assetText = count === 1 ? "asset" : "assets";
  const displayText = `${count} ${assetText}`;

  // For single asset, show direct link instead of popover
  if (count === 1 && data?.assets?.[0]) {
    return (
      <Button
        variant="link"
        to={`/assets/${data.assets[0].id}`}
        target="_blank"
        className="h-auto p-0 text-black underline hover:text-primary"
      >
        {data.assets[0].title}
      </Button>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="link"
          className="h-auto p-0 text-black underline hover:text-primary"
        >
          {displayText}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="z-[999999] max-h-48 w-80 overflow-y-auto rounded border bg-surface p-3"
        side="top"
        sideOffset={8}
      >
        {isLoading && (
          <div className="flex items-center justify-center py-4">
            <Spinner className="size-4" />
            <span className="ml-2 text-sm text-color-500">
              Loading assets...
            </span>
          </div>
        )}

        {!isLoading && data && (
          <div className="space-y-1">
            {data.assets.map((asset) => (
              <div
                key={asset.id}
                className="flex items-center gap-2 text-sm text-color-700"
              >
                <AssetImage
                  className="size-5"
                  asset={{
                    id: asset.id,
                    thumbnailImage: asset.mainImage ?? null,
                    mainImage: asset.mainImage ?? null,
                    mainImageExpiration: null,
                  }}
                  alt={`${asset.title} main image`}
                />
                <Button
                  variant="link"
                  to={`/assets/${asset.id}`}
                  target="_blank"
                  className="h-auto p-0 font-medium text-color-700 hover:text-color-900"
                >
                  {asset.title}
                </Button>
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="py-2 text-sm text-color-500">
            Failed to load asset details
          </div>
        )}

        {!isLoading && data?.assets.length === 0 && (
          <div className="py-2 text-sm text-color-500">No assets found</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
