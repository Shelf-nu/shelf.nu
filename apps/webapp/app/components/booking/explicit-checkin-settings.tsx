/**
 * Explicit Check-in Settings
 *
 * The "Explicit check-in requirement" card on Settings > Bookings. When a
 * switch is on, that role cannot use the one-click quick check-in: the web
 * check-in control links straight to the explicit check-in page, and the
 * quick check-in is refused on the server (web and mobile).
 *
 * @see {@link file://./explicit-requirement-settings-card.tsx} - shared layout
 * @see {@link file://./../../routes/_layout+/settings.bookings.tsx} - the
 *   `updateExplicitCheckin` action that persists it
 */
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
      intent="updateExplicitCheckin"
      switches={[
        {
          name: "requireExplicitCheckinForAdmin" satisfies ExplicitCheckinField,
          label: "Require explicit check-in for Admins",
          description:
            "When enabled, administrators must use the scanner-based explicit check-in flow instead of the one-click quick check-in.",
          defaultChecked: defaultValues.requireExplicitCheckinForAdmin,
        },
        {
          name: "requireExplicitCheckinForSelfService" satisfies ExplicitCheckinField,
          label: "Require explicit check-in for Self Service",
          description:
            "When enabled, self-service users must use the scanner-based explicit check-in flow instead of the one-click quick check-in.",
          defaultChecked: defaultValues.requireExplicitCheckinForSelfService,
        },
      ]}
    />
  );
}
