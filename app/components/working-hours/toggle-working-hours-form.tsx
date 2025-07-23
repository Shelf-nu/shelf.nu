import { useFetcher } from "@remix-run/react";
import { useZorm } from "react-zorm";
import { useDisabled } from "~/hooks/use-disabled";
import { WorkingHoursToggleSchema } from "~/modules/working-hours/zod-utils";
import FormRow from "../forms/form-row";
import { Switch } from "../forms/switch";
import { Card } from "../shared/card";

export function EnableWorkingHoursForm({
  enabled,
  header,
}: {
  enabled: boolean;
  header: { title: string; subHeading?: string };
}) {
  const disabled = useDisabled();
  const fetcher = useFetcher();
  const zo = useZorm("EnableWorkingHoursForm", WorkingHoursToggleSchema);
  return (
    <Card className="mt-0">
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-color-600">{header.subHeading}</p>
      </div>
      <div>
        <fetcher.Form
          ref={zo.ref}
          method="post"
          onChange={(e) => fetcher.submit(e.currentTarget)}
        >
          <FormRow
            rowLabel={`Enable working hours`}
            subHeading={
              <div>Working hours will be enabled for your workspace.</div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={zo.fields.enableWorkingHours()}
                disabled={disabled} // Disable for self service users
                defaultChecked={enabled}
                required
                title={"Toggle working hours"}
              />
              <label
                htmlFor={`enableWorkingHours-${zo.fields.enableWorkingHours()}`}
                className=" hidden text-color-500"
              >
                Enable working hours
              </label>
            </div>
            <input type="hidden" value="toggle" name="intent" />
          </FormRow>
        </fetcher.Form>
      </div>
    </Card>
  );
}
