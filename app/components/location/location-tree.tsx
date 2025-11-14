import type { Location } from "@prisma/client";
import { Button } from "../shared/button";

/**
 * Minimal tree node structure used across location UI elements. Keeps the
 * payload tiny while still allowing nested rendering.
 */
export type LocationTreeNode = Pick<Location, "id" | "name"> & {
  children: LocationTreeNode[];
};

type LocationTreeProps = {
  nodes: LocationTreeNode[];
  /** Optional node id to highlight (rendered as a non-clickable pill). */
  activeId?: string;
  /** When true, link clicks open in a new tab. */
  targetBlank?: boolean;
};

export function LocationTree({
  nodes,
  activeId,
  targetBlank = true,
}: LocationTreeProps) {
  if (!nodes.length) return null;

  return (
    <ul className="space-y-1">
      {nodes.map((node) => {
        const isActive = node.id === activeId;
        return (
          <li key={node.id} className="space-y-1">
            {isActive ? (
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-900">
                {node.name}
              </div>
            ) : (
              <Button
                to={`/locations/${node.id}`}
                variant="block-link"
                target={targetBlank ? "_blank" : undefined}
              >
                {node.name}
              </Button>
            )}
            {node.children.length ? (
              <div className="ml-4 border-l border-gray-200 pl-4">
                <LocationTree
                  nodes={node.children}
                  activeId={activeId}
                  targetBlank={targetBlank}
                />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
