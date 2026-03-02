import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Card } from "~/components/shared/card";
import { useDisabled } from "~/hooks/use-disabled";

export const TagsRequiredSettingsSchema = z.object({
  tagsRequired: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export function TagsRequiredSettings({
  header,
  defaultValue = false,
}: {
  header: { title: string; subHeading?: string };
  defaultValue: boolean;
}) {
  const fetcher = useFetcher();
  const disabled = useDisabled();
  const zo = useZorm("TagsRequiredForm", TagsRequiredSettingsSchema);

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
            rowLabel="Require tags for bookings"
            subHeading={
              <div>
                When enabled, users must add at least one tag to their bookings.
                This helps with categorization and organization of bookings.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={zo.fields.tagsRequired()}
                disabled={disabled}
                defaultChecked={defaultValue}
                title="Require tags for bookings"
              />
              <label
                htmlFor={`tagsRequired-${zo.fields.tagsRequired()}`}
                className=" hidden text-gray-500"
              >
                Require tags for bookings
              </label>
            </div>
          </FormRow>
          <input type="hidden" value="updateTagsRequired" name="intent" />
        </fetcher.Form>
      </div>
    </Card>
  );
}
