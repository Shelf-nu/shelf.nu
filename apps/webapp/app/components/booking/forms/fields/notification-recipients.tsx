/**
 * Per-booking notification recipients field.
 *
 * Rendered inside the booking create/edit form. Allows admin/owner users to
 * add extra team members who should receive email notifications for this
 * specific booking. Non-admin users do not see this field (privacy gating).
 *
 * The component also renders a {@link NotificationPreview} that merges
 * workspace-level settings (custodian, creator, always-notify members) with
 * per-booking selections to give a complete picture of who will be notified.
 *
 * @module
 */
import { useMemo } from "react";
import FormRow from "~/components/forms/form-row";
import MultiSelect from "~/components/multi-select/multi-select";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { NotificationPreview } from "../../notification-preview";

/**
 * Team member shape used by the notification recipients multi-select.
 * Includes the optional `user` relation for display-name resolution.
 */
export type NotificationRecipientTeamMember = {
  id: string;
  name: string;
  user?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
};

type NotificationRecipientsFieldProps = {
  teamMembers: NotificationRecipientTeamMember[];
  defaultSelected?: NotificationRecipientTeamMember[];
  disabled?: boolean;
  isAdminOrOwner: boolean;
  /** Name of the custodian for this booking */
  custodianName?: string;
  /** Name of the creator, if different from custodian */
  creatorName?: string;
  /** Number of admins in the workspace (for the preview count) */
  adminCount?: number;
};

/**
 * Derives a human-readable label for a team member.
 * Prefers the user's full name (firstName + lastName) when available,
 * falling back to the team member's `name` field for invited-but-not-yet-
 * registered members who only have a team member record.
 */
function formatTeamMemberLabel(tm: NotificationRecipientTeamMember): string {
  const fullName = [tm.user?.firstName, tm.user?.lastName]
    .filter(Boolean)
    .join(" ");
  return fullName || tm.name;
}

/**
 * Per-booking notification recipients field with live preview.
 *
 * **Visibility:** Only rendered for admin/owner users. Returns `null` for
 * self-service/base users to prevent them from seeing who else is notified
 * (privacy requirement).
 *
 * **Preview computation:** Uses `useBookingSettings()` to read workspace-level
 * notification configuration and merges it with per-booking selections to
 * produce a combined preview of all notification recipients and their reasons.
 *
 * @param teamMembers - All eligible team members for the multi-select
 * @param defaultSelected - Pre-selected recipients (for editing existing bookings)
 * @param disabled - Whether the field is disabled (e.g. during submission)
 * @param isAdminOrOwner - Gates visibility; returns null when false
 * @param custodianName - Display name of the booking custodian (always notified)
 * @param creatorName - Display name of the booking creator (if different from custodian)
 * @param adminCount - Number of workspace admins (shown in the preview footnote)
 */
export function NotificationRecipientsField({
  teamMembers,
  defaultSelected,
  disabled,
  isAdminOrOwner,
  custodianName,
  creatorName,
  adminCount,
}: NotificationRecipientsFieldProps) {
  const bookingSettings = useBookingSettings();

  // Build the notification preview by merging all recipient sources.
  // Each section is added in priority order with deduplication via `seen` set:
  //   1. Custodian — always receives all notifications (system rule)
  //   2. Creator — only if workspace setting is enabled and different from custodian
  //   3. Always-notify members — from workspace-level settings
  //   4. Per-booking recipients — from the multi-select (defaultSelected)
  const previewRecipients = useMemo(() => {
    const recipients: Array<{ name: string; reason: string }> = [];
    // Deduplicate by stable team member ID (not display name) to avoid
    // collapsing different people who share the same formatted name
    const seenIds = new Set<string>();

    // Custodian is always notified (this is a system-level guarantee)
    // Uses name string as key since we don't have custodian's TM ID here
    if (custodianName) {
      recipients.push({ name: custodianName, reason: "custodian" });
    }

    // Creator — only shown when the workspace setting `notifyBookingCreator` is on
    if (
      bookingSettings?.notifyBookingCreator &&
      creatorName &&
      creatorName !== custodianName
    ) {
      recipients.push({ name: creatorName, reason: "creator" });
    }

    // Always-notify team members — configured at the workspace level in Settings > Bookings
    if (bookingSettings?.alwaysNotifyTeamMembers) {
      for (const tm of bookingSettings.alwaysNotifyTeamMembers) {
        if (!seenIds.has(tm.id)) {
          recipients.push({
            name: formatTeamMemberLabel(tm),
            reason: "always_notify",
          });
          seenIds.add(tm.id);
        }
      }
    }

    // Per-booking recipients — manually added to this specific booking via the multi-select
    if (defaultSelected) {
      for (const tm of defaultSelected) {
        if (seenIds.has(tm.id)) continue;
        recipients.push({
          name: formatTeamMemberLabel(tm),
          reason: "booking_recipient",
        });
        seenIds.add(tm.id);
      }
    }

    return recipients;
  }, [custodianName, creatorName, bookingSettings, defaultSelected]);

  if (!isAdminOrOwner) {
    return null;
  }

  const items = teamMembers.map((tm) => ({
    label: formatTeamMemberLabel(tm),
    value: tm.id,
  }));

  const defaultItems = defaultSelected?.map((tm) => ({
    label: formatTeamMemberLabel(tm),
    value: tm.id,
  }));

  return (
    <FormRow
      rowLabel="Notifications"
      className="mobile-styling-only border-b-0 p-0"
    >
      <MultiSelect
        className="w-full"
        label="Additional notification recipients"
        items={items}
        defaultSelected={defaultItems}
        labelKey="label"
        valueKey="value"
        name="notificationRecipientIds"
        disabled={disabled}
        placeholder="Search users..."
      />
      <p className="mt-2 text-[14px] text-gray-600">
        These users will receive all email notifications for this booking.
      </p>
      <NotificationPreview
        recipients={previewRecipients}
        adminCount={adminCount ?? 0}
        notifyAdminsOnNewBooking={
          bookingSettings?.notifyAdminsOnNewBooking ?? true
        }
      />
    </FormRow>
  );
}
