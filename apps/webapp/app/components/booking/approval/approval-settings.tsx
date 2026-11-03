/**
 * Booking approval settings card.
 *
 * Two switches, one per requesting role: `requireApprovalForBase` (on by
 * default) and `requireApprovalForSelfService` (off by default). Posts intent
 * `updateBookingApproval` on change, so there is no save button. Reservations
 * made while a switch is off are approved at write time, so turning one on
 * only affects new requests.
 *
 * @see {@link file://./../../../routes/_layout+/settings.bookings.tsx}
 */
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";

/**
 * Parses the switches' submission.
 *
 * An unchecked switch posts no field at all and a checked one posts the string
 * `"on"`, so each value is transformed to a boolean and defaults to false.
 */
const onOff = z
  .string()
  .transform((val) => val === "on")
  .default("false");

export const ApprovalSettingsSchema = z.object({
  requireApprovalForBase: onOff,
  requireApprovalForSelfService: onOff,
});

/**
 * Renders the two approval switches inside a settings card.
 *
 * @param props.header - Card title and optional sub-heading.
 * @param props.defaultValues - The workspace's current switches.
 * @returns The settings card element.
 */
export function ApprovalSettings({
  header,
  defaultValues,
}: {
  header: { title: string; subHeading?: string };
  defaultValues: {
    requireApprovalForBase: boolean;
    requireApprovalForSelfService: boolean;
  };
}) {
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);

  const zo = useZorm("ApprovalSettingsForm", ApprovalSettingsSchema);

  // Bind each visually hidden label to its Switch through one shared id, so
  // the control has a programmatically associated accessible name.
  const baseField = zo.fields.requireApprovalForBase();
  const baseFieldId = `requireApprovalForBase-${baseField}`;
  const selfServiceField = zo.fields.requireApprovalForSelfService();
  const selfServiceFieldId = `requireApprovalForSelfService-${selfServiceField}`;

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
            rowLabel="Base users request bookings"
            subHeading={
              <div>
                A Base user never checks out themself: an administrator or
                manager hands the gear over. With this on, their reservation is
                a request that shows as "Pending approval" until an
                administrator or manager approves it, either with the Approve
                button or simply by checking it out. The requested items are
                held either way.
              </div>
            }
            className="pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                id={baseFieldId}
                name={baseField}
                disabled={disabled}
                defaultChecked={defaultValues.requireApprovalForBase}
                title="Base users request bookings"
              />
              <label htmlFor={baseFieldId} className="sr-only text-gray-500">
                Base users request bookings
              </label>
            </div>
          </FormRow>
          <FormRow
            rowLabel="Self service users request bookings"
            subHeading={
              <div>
                Self service users check gear out and back in themselves. Off,
                their reservation is final at once. On, an administrator or
                manager must approve it first; after that they still check out
                on their own. Requests still waiting when you switch this off
                can be checked out meanwhile, and need a decision again if you
                switch it back on.
              </div>
            }
            className="border-b-0 pb-[10px]"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                id={selfServiceFieldId}
                name={selfServiceField}
                disabled={disabled}
                defaultChecked={defaultValues.requireApprovalForSelfService}
                title="Self service users request bookings"
              />
              <label
                htmlFor={selfServiceFieldId}
                className="sr-only text-gray-500"
              >
                Self service users request bookings
              </label>
            </div>
          </FormRow>
          <input type="hidden" value="updateBookingApproval" name="intent" />
        </fetcher.Form>
      </div>
    </Card>
  );
}
