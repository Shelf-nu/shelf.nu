import React, { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@radix-ui/react-popover";
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

interface Kit {
  id: string;
  name: string;
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
        className="h-auto p-0 text-black underline hover:no-underline"
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
          className="h-auto p-0 text-black underline hover:no-underline"
        >
          {displayText}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="z-[999999] max-h-[400px] w-80 overflow-scroll rounded-md border bg-white"
        side="top"
        sideOffset={8}
      >
        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Spinner className="size-4" />
              <span className="ml-2 text-sm text-gray-500">
                Loading kits...
              </span>
            </div>
          )}

          {!isLoading && data && (
            <div className="space-y-2">
              {data.kits.map((kit) => (
                <a
                  key={kit.id}
                  href={`/kits/${kit.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-decoration-none flex items-center space-x-3 rounded p-2 hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {kit.name}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}

          {!isLoading && error && (
            <div className="py-2 text-sm text-gray-500">
              Failed to load kit details
            </div>
          )}

          {!isLoading && data?.kits.length === 0 && (
            <div className="py-2 text-sm text-gray-500">No kits found</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
