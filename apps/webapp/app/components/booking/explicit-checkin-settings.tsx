import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { tw } from "~/utils/tw";
import FormRow from "../forms/form-row";
import { Switch } from "../forms/switch";
import { Card } from "../shared/card";

export const ExplicitCheckinSettingsSchema = z.object({
  requireExplicitCheckinForAdmin: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
  requireExplicitCheckinForSelfService: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

export function ExplicitCheckinSettings({
  header,
  defaultValues,
}: {
  header: { title: string; subHeading?: string };
  defaultValues: {
    requireExplicitCheckinForAdmin: boolean;
    requireExplicitCheckinForSelfService: boolean;
  };
}) {
  const fetcher = useFetcher();
  const { isOwner } = useUserRoleHelper();
  const zo = useZorm("ExplicitCheckinForm", ExplicitCheckinSettingsSchema);

  return (
    <Card className={tw("my-0")}>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-color-600">{header.subHeading}</p>
      </div>
      <div>
        <fetcher.Form
          ref={zo.ref}
          method="post"
          onChange={(e) => {
            if (isOwner) {
              void fetcher.submit(e.currentTarget);
            }
          }}
        >
          <FormRow
            rowLabel="Require explicit check-in for Admins"
            subHeading={
              <div>
                When enabled, administrators must use the scanner-based explicit
                check-in flow instead of the one-click quick check-in.
              </div>
            }
            className="border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={zo.fields.requireExplicitCheckinForAdmin()}
                disabled={!isOwner}
                defaultChecked={defaultValues.requireExplicitCheckinForAdmin}
                title="Require explicit check-in for Admins"
              />
              <label
                htmlFor={`requireExplicitCheckinForAdmin-${zo.fields.requireExplicitCheckinForAdmin()}`}
                className="hidden text-color-500"
              >
                Require explicit check-in for Admins
              </label>
            </div>
          </FormRow>
          <FormRow
            rowLabel="Require explicit check-in for Self Service"
            subHeading={
              <div>
                When enabled, self-service users must use the scanner-based
                explicit check-in flow instead of the one-click quick check-in.
              </div>
            }
            className="mt-4 border-b-0 pb-[10px] pt-0"
          >
            <div className="flex flex-col items-center gap-2">
              <Switch
                name={zo.fields.requireExplicitCheckinForSelfService()}
                disabled={!isOwner}
                defaultChecked={
                  defaultValues.requireExplicitCheckinForSelfService
                }
                title="Require explicit check-in for Self Service"
              />
              <label
                htmlFor={`requireExplicitCheckinForSelfService-${zo.fields.requireExplicitCheckinForSelfService()}`}
                className="hidden text-color-500"
              >
                Require explicit check-in for Self Service
              </label>
            </div>
          </FormRow>
          {!isOwner && (
            <p className="text-sm text-color-500">
              Only the workspace owner can change this setting.
            </p>
          )}
          <input type="hidden" value="updateExplicitCheckin" name="intent" />
        </fetcher.Form>
      </div>
    </Card>
  );
}
