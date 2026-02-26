import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { AssetImage } from "~/components/assets/asset-image/component";
import KitImage from "~/components/kits/kit-image";
import { Button } from "~/components/shared/button";
import { Spinner } from "~/components/shared/spinner";
import useApiQuery from "~/hooks/use-api-query";

/**
 * KitsListComponent for Markdoc
 *
 * This component renders an interactive kit count that shows a popover
 * with kit details when clicked. Used in booking activity notes.
 *
 * Usage in markdown content:
 * {% kits_list count=3 ids="id1,id2,id3" action="added" /%}
 */

interface KitsListComponentProps {
  count: number;
  ids: string;
  action: string;
}

interface Asset {
  id: string;
  title: string;
  mainImage?: string;
  mainImageExpiration?: string;
  category?: {
    name: string;
  };
}

interface Kit {
  id: string;
  name: string;
  image?: string;
  imageExpiration?: string;
  assets: Asset[];
  _count: {
    assets: number;
  };
}

export function KitsListComponent({
  count,
  ids,
  action: _action,
}: KitsListComponentProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Use useApiQuery hook for fetching kits
  // For single kits, fetch immediately to show direct link with name
  // For multiple kits, only fetch when popover opens
  const searchParams = new URLSearchParams({ ids });
  const { data, isLoading, error } = useApiQuery<{ kits: Kit[] }>({
    api: "/api/kits",
    searchParams,
    enabled: count === 1 || isOpen,
  });

  // Handle popover open/close
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
  };

  // Determine the text to display
  const kitText = count === 1 ? "kit" : "kits";
  const displayText = `${count} ${kitText}`;

  // For single kit, show direct link instead of popover
  if (count === 1 && data?.kits?.[0]) {
    return (
      <Button
        variant="link"
        to={`/kits/${data.kits[0].id}`}
        target="_blank"
        className="h-auto p-0 text-black underline hover:text-primary"
      >
        {data.kits[0].name}
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
            <span className="ml-2 text-sm text-color-500">Loading kits...</span>
          </div>
        )}

        {!isLoading && data && (
          <div className="space-y-3">
            {data.kits.map((kit) => (
              <div key={kit.id}>
                {/* Kit header */}
                <div className="flex items-center gap-2">
                  <KitImage
                    kit={{
                      kitId: kit.id,
                      image: kit.image || null,
                      imageExpiration: kit.imageExpiration || null,
                      alt: `${kit.name} kit image`,
                    }}
                    className="size-5"
                  />
                  <Button
                    variant="link"
                    to={`/kits/${kit.id}`}
                    target="_blank"
                    className="h-auto p-0 font-medium text-color-700 hover:text-color-900"
                  >
                    {kit.name}
                  </Button>
                  <span className="text-xs text-color-500">
                    ({kit.assets.length} assets)
                  </span>
                  <span className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
                    KIT
                  </span>
                </div>

                {/* Kit assets */}
                {kit.assets.length > 0 && (
                  <ul className="ml-6 mt-2 space-y-1">
                    {kit.assets.map((asset) => (
                      <li
                        key={asset.id}
                        className="flex items-center gap-2 text-sm text-color-700"
                      >
                        <AssetImage
                          className="size-5"
                          asset={{
                            id: asset.id,
                            thumbnailImage: asset.mainImage ?? null,
                            mainImage: asset.mainImage ?? null,
                            mainImageExpiration: asset.mainImageExpiration
                              ? new Date(asset.mainImageExpiration)
                              : null,
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
                        {asset.category && (
                          <span className="text-color-500">
                            ({asset.category.name})
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && (
          <div className="py-2 text-sm text-color-500">
            Failed to load kit details
          </div>
        )}

        {!isLoading && data?.kits.length === 0 && (
          <div className="py-2 text-sm text-color-500">No kits found</div>
        )}
      </PopoverContent>
    </Popover>
  );
}
