import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "~/components/shared/button";

// Generic blocker configuration type
export type BlockerConfig = {
  // Checks if this blocker should be shown
  condition: boolean;
  // Count of items that match this blocker condition
  count: number;
  // Message to display for this blocker
  message: (count: number) => ReactNode;
  // Optional: Additional description or notes
  description?: ReactNode;
  // Function to handle resolving this blocker
  onResolve: () => void;
};

// Type for the createBlockers arguments
type CreateBlockersArgs = {
  blockerConfigs: BlockerConfig[];
  onResolveAll: () => void;
};

/**
 * Creates a Blockers component configured with the provided blockers
 * @param args Configuration for the blockers component
 * @returns A tuple containing hasBlockers and the Blockers component
 */
export function createBlockers({
  blockerConfigs,
  onResolveAll,
}: CreateBlockersArgs) {
  // Filter out configs where the condition is false
  const activeBlockers = blockerConfigs.filter((blocker) => blocker.condition);
  const hasBlockers = activeBlockers.length > 0;

  // Calculate total unresolved conflicts
  const totalUnresolvedConflicts = activeBlockers.reduce(
    (sum, blocker) => sum + blocker.count,
    0
  );

  // Create the blockers component
  function Blockers() {
    if (!hasBlockers) return null;

    return (
      <motion.div
        className="bg-color-25 p-4 text-[12px]"
        transition={{ duration: 0.2 }}
        exit={{ opacity: 0 }}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[14px] font-semibold">
              ⚠️ Unresolved blockers ({totalUnresolvedConflicts})
            </p>
            <p className="leading-4">
              Resolve the issues below to continue. They are currently blocking
              you from being able to confirm.
            </p>
          </div>

          <Button
            variant="secondary"
            size="xs"
            className="whitespace-nowrap text-[12px] leading-3"
            onClick={onResolveAll}
            title="Removes all conflicting items from the list"
          >
            Resolve all ({totalUnresolvedConflicts})
          </Button>
        </div>

        <hr className="my-2" />
        <ul className="list-inside list-disc text-[12px] text-color-500">
          {activeBlockers.map((blocker, index) => (
            <li key={index}>
              {blocker.message(blocker.count)}{" "}
              <Button
                variant="link"
                type="button"
                className="text-gray inline text-[12px] font-normal underline"
                onClick={blocker.onResolve}
              >
                Remove from list
              </Button>
              {blocker.description && (
                <p className="text-[10px]">{blocker.description}</p>
              )}
            </li>
          ))}
        </ul>
      </motion.div>
    );
  }

  return [hasBlockers, Blockers] as const;
}
