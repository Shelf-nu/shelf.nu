import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";

export const ApprovalSettingsSchema = z.object({
  requireBookingApproval: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export function ApprovalSettings({
  header,
  defaultValue = false,
}: {
  header: { title: string; subHeading?: string };
  defaultValue: boolean;
}) {
  const fetcher = useFetcher();
  const disabled = useDisabled();
  const zo = useZorm("ApprovalSettingsForm", ApprovalSettingsSchema);

  return (
    <Card>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        <fetcher.Form
          ref={zo.ref}
          method="post"
          onChange={(e) => void fetcher.submit(e.currentTarget)}
        >
          <FormRow
            rowLabel="Require approval for booking requests"
            subHeading={
              <div>
                When enabled, bookings reserved by Base and Self service users
                wait for an admin&apos;s approval before they can be checked
                out. The requested items are still held for the booking period.
                Enabling this does not affect already-reserved bookings — only
                new requests need approval.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={zo.fields.requireBookingApproval()}
                disabled={disabled}
                defaultChecked={defaultValue}
                title="Require approval for booking requests"
              />
              <label
                htmlFor={`requireBookingApproval-${zo.fields.requireBookingApproval()}`}
                className=" hidden text-gray-500"
              >
                Require approval for booking requests
              </label>
            </div>
          </FormRow>
          <input
            type="hidden"
            value="updateRequireBookingApproval"
            name="intent"
          />
        </fetcher.Form>
      </div>
    </Card>
  );
}
