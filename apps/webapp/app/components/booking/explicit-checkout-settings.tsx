/**
 * Explicit Check-out Settings
 *
 * The "Check-out needs each item scanned or selected" card on Settings >
 * Bookings. When a switch is on, that role cannot use the one-click check-out
 * ("Check out" on a reserved booking, "Check out remaining" on an ongoing one,
 * "Check Out All Assets" in the mobile app): the web check-out control offers
 * only "Scan to check out", and the one-click check-out is refused on the
 * server (web and mobile). Scanning or selecting the assets stays available.
 * The workspace owner is never restricted, and Base users hold no check-out
 * permission, so the card has two switches: Admins and Managers, and Self
 * Service users. All of its words come from `@shelf/labels`, which the phone
 * reads too.
 *
 * @see {@link file://./explicit-requirement-settings-card.tsx} - shared layout
 * @see {@link file://./../../routes/_layout+/settings.bookings.tsx} - the
 *   `updateExplicitCheckout` action that persists it
 */
import {
  EXPLICIT_REQUIREMENT_LABELS,
  EXPLICIT_REQUIREMENT_ROLE_LABELS,
  explicitRequirementSwitchDescription,
} from "@shelf/labels";
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
      exemption={EXPLICIT_REQUIREMENT_LABELS.CHECKOUT.EXEMPTION}
      intent="updateExplicitCheckout"
      switches={[
        {
          name: "requireExplicitCheckoutForAdmin" satisfies ExplicitCheckoutField,
          label: EXPLICIT_REQUIREMENT_ROLE_LABELS.ADMIN,
          description: explicitRequirementSwitchDescription(
            "CHECKOUT",
            "ADMIN"
          ),
          defaultChecked: defaultValues.requireExplicitCheckoutForAdmin,
        },
        {
          name: "requireExplicitCheckoutForSelfService" satisfies ExplicitCheckoutField,
          label: EXPLICIT_REQUIREMENT_ROLE_LABELS.SELF_SERVICE,
          description: explicitRequirementSwitchDescription(
            "CHECKOUT",
            "SELF_SERVICE"
          ),
          defaultChecked: defaultValues.requireExplicitCheckoutForSelfService,
        },
      ]}
    />
  );
}
