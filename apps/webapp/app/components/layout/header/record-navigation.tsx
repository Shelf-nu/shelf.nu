import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import type { RecordNavigationState } from "~/hooks/use-list-context";
import type { NeighbourRef } from "~/modules/list-navigation/list-context";

/** Why both arrows are off on a page that was not opened from a list. */
export const NO_LIST_CONTEXT_REASON = "Open from a list to step through it";

/**
 * Previous/next arrows for a detail page header, like Shopify's order arrows.
 * They step through the list the page was opened from; the state, the load
 * and the `[` / `]` shortcuts come from `useRecordNavigation`.
 */
export function RecordNavigation({
  navigation,
}: {
  navigation: RecordNavigationState;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <ArrowButton
        label="Previous in list"
        icon={<ChevronUpIcon className="size-4" aria-hidden />}
        neighbour={navigation.prev}
        navigation={navigation}
      />
      <ArrowButton
        label="Next in list"
        icon={<ChevronDownIcon className="size-4" aria-hidden />}
        neighbour={navigation.next}
        navigation={navigation}
      />
    </div>
  );
}

function ArrowButton({
  label,
  icon,
  neighbour,
  navigation,
}: {
  label: string;
  icon: ReactNode;
  neighbour: NeighbourRef | null;
  navigation: RecordNavigationState;
}) {
  const disabled =
    navigation.status === "no-context"
      ? { reason: NO_LIST_CONTEXT_REASON }
      : !neighbour;

  return (
    <Button
      type="button"
      variant="secondary"
      className="p-2"
      aria-label={label}
      tooltip={label}
      disabled={disabled}
      onClick={() => {
        if (neighbour) navigation.goTo(neighbour);
      }}
    >
      {icon}
    </Button>
  );
}
