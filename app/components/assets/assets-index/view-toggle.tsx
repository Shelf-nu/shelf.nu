import { CalendarIcon, ListIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
import { useSearchParams } from "~/hooks/search-params";
import { tw } from "~/utils/tw";

export function AssetsIndexViewToggle() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get("view") ?? "table";
  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";
  const isAvailabilityView = view === "availability";

  return (
    <div className="flex items-start gap-2">
      <ButtonGroup>
        <Button
          variant="secondary"
          className={tw(
            "px-[14px] py-[10px] hover:cursor-pointer",
            !isAvailabilityView ? disabledButtonStyles : ""
          )}
          type="button"
          onClick={() => {
            setSearchParams((prev) => {
              const newParams = new URLSearchParams(prev);
              newParams.delete("view");
              return newParams;
            });
          }}
          title="Switch to list view"
        >
          <ListIcon className="size-5" />
        </Button>
        <Button
          variant="secondary"
          className={tw(
            "px-[14px] py-[10px] hover:cursor-pointer",
            isAvailabilityView ? disabledButtonStyles : ""
          )}
          type={"button"}
          onClick={() => {
            setSearchParams((prev) => {
              const newParams = new URLSearchParams(prev);
              newParams.set("view", "availability");
              return newParams;
            });
          }}
          title={"Switch to availability view"}
        >
          <CalendarIcon className="size-5" />
        </Button>
      </ButtonGroup>
    </div>
  );
}
