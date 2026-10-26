// Both toggle glyphs come from the same icon set. Radix icons are drawn on a
// 15x15 viewBox with hairline paths; a lucide icon is 24x24 with a 2px
// stroke, so at the same rendered size it reads markedly bolder beside one.
import { CalendarIcon, CubeIcon } from "@radix-ui/react-icons";
import { Button } from "~/components/shared/button";
import { ButtonGroup } from "~/components/shared/button-group";
import { useAssetIndexView } from "~/hooks/use-asset-index-view";
import { tw } from "~/utils/tw";

/**
 * Switches the asset index between its list, availability and model views.
 *
 * Renders nothing when no alternative view is offered for the current page or
 * viewport. The model button appears only in advanced mode.
 */
export function AvailabilityViewToggle({
  modeIsSimple = true,
}: {
  modeIsSimple?: boolean;
}) {
  const { view, shouldShowAvailabilityView, shouldShowModelView, setView } =
    useAssetIndexView();

  if (!shouldShowAvailabilityView) {
    return null;
  }

  const disabledButtonStyles =
    "cursor-not-allowed pointer-events-none bg-gray-50 text-gray-800";
  const buttonStyles = (isActive: boolean) =>
    tw(
      "px-[14px] font-normal text-gray-600 hover:cursor-pointer",
      isActive ? disabledButtonStyles : "",
      modeIsSimple ? "py-[10px]" : ""
    );

  return (
    <div className="flex items-start gap-2">
      <ButtonGroup>
        <Button
          variant="secondary"
          className={buttonStyles(view === "table")}
          disabled={view === "table"}
          type="button"
          onClick={() => setView("table")}
          title="Switch to list view"
          tooltip="List view"
          aria-label="Switch to list view"
          icon="sort"
        />
        <Button
          variant="secondary"
          className={buttonStyles(view === "availability")}
          disabled={view === "availability"}
          type="button"
          onClick={() => setView("availability")}
          title="Switch to availability view"
          tooltip="Availability view"
          aria-label="Switch to availability view"
        >
          <CalendarIcon className="size-5" />
        </Button>
        {shouldShowModelView ? (
          <Button
            variant="secondary"
            className={buttonStyles(view === "models")}
            disabled={view === "models"}
            type="button"
            onClick={() => setView("models")}
            title="Switch to asset model view"
            tooltip="Asset model view"
            aria-label="Switch to asset model view"
          >
            <CubeIcon className="size-5" />
          </Button>
        ) : null}
      </ButtonGroup>
    </div>
  );
}
