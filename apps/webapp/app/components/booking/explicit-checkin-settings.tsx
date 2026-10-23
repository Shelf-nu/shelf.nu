/**
 * Explicit Check-in Settings
 *
 * The "Check-in needs each item scanned or selected" card on Settings >
 * Bookings. When a switch is on, that role cannot use the one-click quick
 * check-in: the web check-in control links straight to the explicit check-in
 * page, and the quick check-in is refused on the server (web and mobile).
 * Scanning the items and selecting them from the list both stay open. The
 * workspace owner is never restricted, and Base users hold no check-in
 * permission, so the card has two switches: Admins and Managers, and Self
 * Service users. All of its words come from `@shelf/labels`, which the phone
 * reads too.
 *
 * @see {@link file://./explicit-requirement-settings-card.tsx} - shared layout
 * @see {@link file://./../../routes/_layout+/settings.bookings.tsx} - the
 *   `updateExplicitCheckin` action that persists it
 */
import {
  EXPLICIT_REQUIREMENT_LABELS,
  EXPLICIT_REQUIREMENT_ROLE_LABELS,
  explicitRequirementSwitchDescription,
} from "@shelf/labels";
import z from "zod";
import { ExplicitRequirementSettingsCard } from "./explicit-requirement-settings-card";

/**
 * Parses the explicit check-in switches. A checked switch submits `"on"` and an
 * unchecked one submits nothing, so each field defaults to `false`.
 */
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

type ExplicitCheckinField = keyof z.infer<typeof ExplicitCheckinSettingsSchema>;

/**
 * Renders the explicit check-in card.
 *
 * @param props.header - Card title and sub-heading
 * @param props.defaultValues - The persisted value of each switch
 * @returns The settings card
 */
export function ExplicitCheckinSettings({
  header,
  defaultValues,
}: {
  header: { title: string; subHeading?: string };
  defaultValues: Record<ExplicitCheckinField, boolean>;
}) {
  return (
    <ExplicitRequirementSettingsCard
      header={header}
      exemption={EXPLICIT_REQUIREMENT_LABELS.CHECKIN.EXEMPTION}
      intent="updateExplicitCheckin"
      switches={[
        {
          name: "requireExplicitCheckinForAdmin" satisfies ExplicitCheckinField,
          label: EXPLICIT_REQUIREMENT_ROLE_LABELS.ADMIN,
          description: explicitRequirementSwitchDescription("CHECKIN", "ADMIN"),
          defaultChecked: defaultValues.requireExplicitCheckinForAdmin,
        },
        {
          name: "requireExplicitCheckinForSelfService" satisfies ExplicitCheckinField,
          label: EXPLICIT_REQUIREMENT_ROLE_LABELS.SELF_SERVICE,
          description: explicitRequirementSwitchDescription(
            "CHECKIN",
            "SELF_SERVICE"
          ),
          defaultChecked: defaultValues.requireExplicitCheckinForSelfService,
        },
      ]}
    />
  );
}
