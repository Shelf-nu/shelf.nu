import { useHydrated } from "remix-utils/use-hydrated";
import { ChevronRight } from "../icons/library";
import { Button } from "../shared/button";

export default function ActionsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button variant="secondary" to="#">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );
  }

  return <div className="actions-dropdown flex">Actions Dropdown</div>;
}
