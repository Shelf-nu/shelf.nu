import { useEffect, useMemo, useState } from "react";
import type { Location } from "@prisma/client";
import { HoverCardPortal } from "@radix-ui/react-hover-card";
import { ListTree } from "lucide-react";
import useApiQuery from "~/hooks/use-api-query";
import type { LocationTreePayload } from "~/routes/api+/locations.$locationId.tree";
import { tw } from "~/utils/tw";
import { LocationTree, type LocationTreeNode } from "./location-tree";
import { Button } from "../shared/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../shared/hover-card";
import { Tag } from "../shared/tag";

/** Minimal shape we expect for a location when rendering badges inline. */
type LocationSummary = Pick<Location, "id" | "name"> & {
  parentId?: Location["parentId"];
};

/** Props accepted by LocationBadge. */
type LocationBadgeProps = {
  /** Location summary with enough data to determine if hierarchy exists. */
  location?: (LocationSummary & { childCount?: number }) | null;
  className?: string;
};

export function LocationBadge({ location, className }: LocationBadgeProps) {
  const [shouldFetch, setShouldFetch] = useState(false);

  useEffect(() => {
    setShouldFetch(false);
  }, [location?.id]);

  const apiEndpoint = useMemo(() => {
    if (!location?.id) return "";
    return `/api/locations/${location.id}/tree`;
  }, [location?.id]);

  // We only need to show icon/fetch hierarchy if there is a parent or child.
  const hasHierarchy =
    Boolean(location?.parentId) || (location?.childCount ?? 0) > 0;

  const { data, isLoading, error } = useApiQuery<LocationTreePayload>({
    api: apiEndpoint,
    enabled: shouldFetch && hasHierarchy && Boolean(location?.id),
  });

  if (!location) {
    return null;
  }

  if (!hasHierarchy) {
    return (
      <Tag className={tw("ml-2 inline-flex items-center gap-1", className)}>
        {location.name}
      </Tag>
    );
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && !shouldFetch) {
      setShouldFetch(true);
    }
  };

  const handleMouseEnter = () => {
    // Kick off fetching slightly ahead of the hover opening animation.
    if (!shouldFetch) {
      setShouldFetch(true);
    }
  };

  const content = (() => {
    if (error) {
      return (
        <p className="text-sm text-red-600">
          {error || "Unable to load location hierarchy."}
        </p>
      );
    }

    if (isLoading || !data || !data.location) {
      return <p className="text-sm text-color-500">Loading hierarchy…</p>;
    }

    const { location: currentLocation, ancestors, descendants } = data;

    const hasChildren = descendants.length > 0;
    const hasAncestors = ancestors.length > 0;

    return (
      <div className="space-y-3 text-sm">
        <div>
          <p className="font-semibold text-color-500">Current location</p>
          <Button
            to={`/locations/${currentLocation.id}`}
            variant="block-link"
            target="_blank"
          >
            {currentLocation.name}
          </Button>
        </div>

        {hasAncestors ? (
          <div>
            <p className="font-semibold text-color-500">Parent chain</p>
            <div className="mt-2">
              <LocationTree
                nodes={buildParentChainTree(ancestors, currentLocation)}
                activeId={currentLocation.id}
              />
            </div>
          </div>
        ) : null}

        <div>
          <p className="font-semibold text-color-500">Child locations</p>
          {hasChildren ? (
            <div className="mt-2">
              <LocationTree nodes={descendants} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-color-600">No child locations.</p>
          )}
        </div>
      </div>
    );
  })();

  return (
    <HoverCard onOpenChange={handleOpenChange} openDelay={0}>
      <HoverCardTrigger asChild>
        <Tag
          className={tw(
            "ml-2 inline-flex items-center gap-1 text-color-700",
            className
          )}
          onMouseEnter={handleMouseEnter}
        >
          <>
            <span className="max-w-[150px] truncate">{location.name}</span>
            <ListTree className="size-3.5" strokeWidth={1.75} />
          </>
        </Tag>
      </HoverCardTrigger>
      <HoverCardPortal>
        <HoverCardContent
          className="max-w-md"
          style={{ width: "max-content", minWidth: "18rem" }}
        >
          {content}
        </HoverCardContent>
      </HoverCardPortal>
    </HoverCard>
  );
}

function buildParentChainTree(
  ancestors: LocationTreePayload["ancestors"],
  current: Pick<LocationTreePayload["location"], "id" | "name">
): LocationTreeNode[] {
  if (!ancestors.length) {
    return [{ id: current.id, name: current.name, children: [] }];
  }

  const root: LocationTreeNode = {
    id: ancestors[0].id,
    name: ancestors[0].name,
    children: [],
  };

  let pointer = root;
  for (let i = 1; i < ancestors.length; i++) {
    const node: LocationTreeNode = {
      id: ancestors[i].id,
      name: ancestors[i].name,
      children: [],
    };
    pointer.children = [node];
    pointer = node;
  }

  pointer.children = [
    {
      id: current.id,
      name: current.name,
      children: [],
    },
  ];

  return [root];
}
