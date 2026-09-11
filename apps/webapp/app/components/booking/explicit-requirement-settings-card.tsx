/**
 * Explicit Requirement Settings Card
 *
 * Owner-only card on Settings > Bookings with one switch per restricted role
 * (Admin, Self Service). A switch that is on means that role must move a
 * booking's assets through the explicit flow (scan or select them) instead of
 * the one-click action. The check-in and check-out cards share this layout and
 * differ only in their fields, copy and action intent.
 *
 * The switches save on change: every change submits the whole form through a
 * fetcher, so the action always receives both values. Only the workspace owner
 * can change them; other viewers see them disabled, with a note.
 *
 * @see {@link file://./explicit-checkin-settings.tsx}
 * @see {@link file://./explicit-checkout-settings.tsx}
 * @see {@link file://./../../routes/_layout+/settings.bookings.tsx} - the action
 *   that persists both cards and refuses non-owners
 */
import { useFetcher } from "react-router";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { tw } from "~/utils/tw";
import FormRow from "../forms/form-row";
import { Switch } from "../forms/switch";
import { Card } from "../shared/card";

/** One role's switch on an explicit-requirement card. */
export type ExplicitRequirementSwitch = {
  /** Form field name; the card's Zod schema parses it in the action */
  name: string;
  /** Row label, also the switch's accessible name */
  label: string;
  /** What turning the switch on changes for that role */
  description: string;
  /** The persisted value, used as the switch's initial state */
  defaultChecked: boolean;
};

/**
 * Renders a save-on-change card of explicit-requirement switches.
 *
 * @param props.header - Card title and sub-heading
 * @param props.intent - Action intent that persists this card's switches
 * @param props.switches - One switch per role, in display order
 * @returns The settings card
 */
export function ExplicitRequirementSettingsCard({
  header,
  intent,
  switches,
}: {
  header: { title: string; subHeading?: string };
  intent: "updateExplicitCheckin" | "updateExplicitCheckout";
  switches: ExplicitRequirementSwitch[];
}) {
  const fetcher = useFetcher();
  const { isOwner } = useUserRoleHelper();

  return (
    <Card>
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">{header.title}</h3>
        <p className="text-sm text-gray-600">{header.subHeading}</p>
      </div>
      <div>
        <fetcher.Form
          method="post"
          onChange={(e) => {
            // The action refuses non-owners on its own; this only skips a
            // request that is certain to fail.
            if (isOwner) {
              void fetcher.submit(e.currentTarget);
            }
          }}
        >
          {switches.map((item, index) => {
            const switchId = `${intent}-${item.name}`;

            return (
              <FormRow
                key={item.name}
                rowLabel={item.label}
                subHeading={<div>{item.description}</div>}
                className={tw("border-b-0 pb-[10px] pt-0", index > 0 && "mt-4")}
              >
                <div className="flex items-center gap-3 lg:flex-col lg:gap-2">
                  <Switch
                    id={switchId}
                    name={item.name}
                    disabled={!isOwner}
                    defaultChecked={item.defaultChecked}
                    title={item.label}
                  />
                  {/* FormRow shows its row label from the lg breakpoint only,
                      and a card holds one switch per role, so below lg this
                      label is the only thing telling the switches apart. */}
                  <label
                    htmlFor={switchId}
                    className="text-sm text-gray-700 lg:sr-only"
                  >
                    {item.label}
                  </label>
                </div>
              </FormRow>
            );
          })}
          {!isOwner && (
            <p className="text-sm text-gray-500">
              Only the workspace owner can change this setting.
            </p>
          )}
          <input type="hidden" value={intent} name="intent" />
        </fetcher.Form>
      </div>
    </Card>
  );
}
