import type { SerializedWorkingHoursOverride } from "~/modules/working-hours/types";

import { tw } from "~/utils/tw";
import { NewOverrideDialog } from "./override-dialog";
import { OverridePreview } from "./override-preview";
import { Card } from "../../shared/card";

export function Overrides({
  overrides,
}: {
  overrides: SerializedWorkingHoursOverride[];
}) {
  return (
    <Card className={tw("my-0")}>
      <div className="flex w-full items-start justify-between border-b pb-4">
        <div className="">
          <h3 className="text-text-lg font-semibold">Date overrides</h3>
          <p className="text-sm text-color-600">
            Add dates when working hours change from your daily hours.
          </p>
        </div>
        <NewOverrideDialog />
      </div>

      {/* Override List */}
      <div className="">
        {overrides.length === 0 ? (
          <div className="py-8 text-center text-color-500">
            <p>No date overrides configured.</p>
            <p className="text-sm">
              Click "Add override" to create your first one.
            </p>
          </div>
        ) : (
          overrides.map((override) => (
            <OverridePreview key={override.id} override={override} />
          ))
        )}
      </div>
    </Card>
  );
}
