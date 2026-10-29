/**
 * Managers Can Edit Assets Form
 *
 * The "Managers" subsection of the Permissions card on Settings > General:
 * one owner-only switch, `Organization.managersCanEditAssets`. On, Managers
 * may add and edit assets and kits, update locations and link codes (the
 * grants live in `WORKSPACE_GRANTS` in `@shelf/permissions`).
 *
 * The switch saves on change through its own fetcher and intent, apart from
 * the visibility switches below it, so an Administrator saving those never
 * submits this one. Only the workspace owner can change it; other viewers see
 * it disabled with a note, as on the explicit check-in card.
 *
 * @see {@link file://./edit-form.tsx} - the Permissions card that renders it
 * @see {@link file://../../routes/_layout+/settings.general.tsx} - the action
 *   that persists it and refuses non-owners
 */
import { useFetcher } from "react-router";
import { z } from "zod";
import { useRevisionOnRefusedSave } from "~/hooks/use-revision-on-refused-save";
import { useRoleAccess } from "~/hooks/use-role-access";
import FormRow from "../forms/form-row";
import { Switch } from "../forms/switch";

/** The action intent that saves this switch. */
export const MANAGERS_CAN_EDIT_ASSETS_INTENT = "updateManagersCanEditAssets";

/** Parses the switch: present and "on" means on, absent means off. */
export const ManagersCanEditAssetsSchema = z.object({
  managersCanEditAssets: z
    .string()
    .transform((value) => value === "on")
    .default("false"),
});

const SWITCH_ID = "managersCanEditAssets";
const LABEL = "Add and edit assets and kits";
const DESCRIPTION_ID = `${SWITCH_ID}-description`;

/**
 * Renders the Managers subsection with its save-on-change switch.
 *
 * @param props.defaultChecked - The stored value of the switch
 * @returns The subsection
 */
export function ManagersCanEditAssetsForm({
  defaultChecked,
}: {
  defaultChecked: boolean;
}) {
  const fetcher = useFetcher({ key: "managersCanEditAssets" });
  const { ownsWorkspace: isOwner } = useRoleAccess();
  // Keyed on the form: a refused save remounts the switch from its stored
  // value.
  const formRevision = useRevisionOnRefusedSave(fetcher);

  return (
    <fetcher.Form
      key={formRevision}
      method="post"
      onChange={(e) => {
        // The action refuses non-owners on its own; this only skips a
        // request that is certain to fail.
        if (isOwner) {
          void fetcher.submit(e.currentTarget);
        }
      }}
    >
      <h4 className="mt-5 text-text-md">Managers</h4>
      <FormRow
        rowLabel={LABEL}
        subHeading={
          <div id={DESCRIPTION_ID}>
            Switch on to let Managers add and edit assets and kits, update
            locations and link codes. They still cannot delete, archive, or
            create categories, locations, tags, custom fields or asset models.
          </div>
        }
        className="border-b-0 pb-[10px]"
        required
      >
        <div className="flex items-center gap-3 lg:flex-col lg:gap-2">
          <Switch
            id={SWITCH_ID}
            name="managersCanEditAssets"
            disabled={!isOwner}
            defaultChecked={defaultChecked}
            title={LABEL}
            aria-describedby={DESCRIPTION_ID}
          />
          {/* FormRow shows its row label from the lg breakpoint only, so
              below lg this label names the switch on screen. */}
          <label
            htmlFor={SWITCH_ID}
            className="text-sm text-gray-700 lg:sr-only"
          >
            {LABEL}
          </label>
        </div>
      </FormRow>
      {!isOwner && (
        <p className="pb-[10px] text-sm text-gray-500">
          Only the workspace owner can change this setting.
        </p>
      )}
      <input
        type="hidden"
        name="intent"
        value={MANAGERS_CAN_EDIT_ASSETS_INTENT}
      />
    </fetcher.Form>
  );
}
