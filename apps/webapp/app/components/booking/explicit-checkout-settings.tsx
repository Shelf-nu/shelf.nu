/**
 * Explicit Check-out Settings
 *
 * The "Explicit check-out requirement" card on Settings > Bookings. When a
 * switch is on, that role cannot use the one-click check-out ("Check out" on a
 * reserved booking, "Check out remaining" on an ongoing one, "Check Out All
 * Assets" in the mobile app): the web check-out control offers only "Scan to
 * check out", and the one-click check-out is refused on the server (web and
 * mobile). Scanning or selecting the assets stays available.
 *
 * @see {@link file://./explicit-requirement-settings-card.tsx} - shared layout
 * @see {@link file://./../../routes/_layout+/settings.bookings.tsx} - the
 *   `updateExplicitCheckout` action that persists it
 */
import z from "zod";
import { ExplicitRequirementSettingsCard } from "./explicit-requirement-settings-card";

/**
 * Parses the explicit check-out switches. A checked switch submits `"on"` and
 * an unchecked one submits nothing, so each field defaults to `false`.
 */
export const ExplicitCheckoutSettingsSchema = z.object({
  requireExplicitCheckoutForAdmin: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
  requireExplicitCheckoutForSelfService: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

type ExplicitCheckoutField = keyof z.infer<
  typeof ExplicitCheckoutSettingsSchema
>;

/**
 * Renders the explicit check-out card.
 *
 * @param props.header - Card title and sub-heading
 * @param props.defaultValues - The persisted value of each switch
 * @returns The settings card
 */
export function ExplicitCheckoutSettings({
  header,
  defaultValues,
}: {
  header: { title: string; subHeading?: string };
  defaultValues: Record<ExplicitCheckoutField, boolean>;
}) {
  return (
    <ExplicitRequirementSettingsCard
      header={header}
      intent="updateExplicitCheckout"
      switches={[
        {
          name: "requireExplicitCheckoutForAdmin" satisfies ExplicitCheckoutField,
          label: "Require explicit check-out for Admins",
          description:
            "When enabled, administrators must use the scanner-based or selection-based explicit check-out flow instead of the one-click check-out.",
          defaultChecked: defaultValues.requireExplicitCheckoutForAdmin,
        },
        {
          name: "requireExplicitCheckoutForSelfService" satisfies ExplicitCheckoutField,
          label: "Require explicit check-out for Self Service",
          description:
            "When enabled, self-service users must use the scanner-based or selection-based explicit check-out flow instead of the one-click check-out.",
          defaultChecked: defaultValues.requireExplicitCheckoutForSelfService,
        },
      ]}
    />
  );
}
