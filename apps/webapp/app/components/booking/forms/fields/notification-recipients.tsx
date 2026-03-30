/**
 * Per-booking notification recipients field with live preview.
 *
 * Rendered inside the booking create/edit form. Allows admin/owner users to
 * add extra team members who should receive email notifications for this
 * specific booking. Non-admin users do not see this field (privacy gating).
 *
 * Uses {@link DynamicDropdown} with the `teamMember` model and
 * `userWithAdminAndOwnerOnly` option, fetching data via the standard
 * `/api/model-filters` endpoint with server-side search.
 *
 * The {@link NotificationPreview} updates dynamically as users are
 * selected/deselected in the dropdown.
 *
 * @module
 */
import { useCallback, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import FormRow from "~/components/forms/form-row";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import { resolveTeamMemberName } from "~/utils/user";
import { NotificationPreview } from "../../notification-preview";

/**
 * Team member shape for pre-selected recipients (edit form).
 * Must include `name` and optional `user` for display name resolution.
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
  /** Pre-selected recipients (for editing existing bookings) */
  defaultSelected?: NotificationRecipientTeamMember[];
  /** Whether the field is disabled (e.g. during submission) */
  disabled?: boolean;
  /** Gates visibility; returns null when false */
  isAdminOrOwner: boolean;
  /** Display name of the booking custodian (always notified) */
  custodianName?: string;
  /** Display name of the booking creator (if different from custodian) */
  creatorName?: string;
  /** Number of workspace admins (shown in the preview footnote) */
  adminCount?: number;
};

/**
 * Per-booking notification recipients field with live preview.
 *
 * **Visibility:** Only rendered for admin/owner users. Returns `null` for
 * self-service/base users to prevent them from seeing who else is notified.
 *
 * **Dynamic preview:** The "Who will be notified" preview updates in real-time
 * as users are selected/deselected in the dropdown.
 */
export function NotificationRecipientsField({
  defaultSelected,
  disabled: _disabled,
  isAdminOrOwner,
  custodianName,
  creatorName,
  adminCount,
}: NotificationRecipientsFieldProps) {
  const bookingSettings = useBookingSettings();

  // Track selected IDs and a name map for the preview
  const [selectedIds, setSelectedIds] = useState<string[]>(
    defaultSelected?.map((tm) => tm.id) ?? []
  );
  const [selectedNameMap, setSelectedNameMap] = useState<Map<string, string>>(
    () => {
      const map = new Map<string, string>();
      defaultSelected?.forEach((tm) =>
        map.set(tm.id, resolveTeamMemberName(tm))
      );
      return map;
    }
  );

  /** When DynamicDropdown selection changes, update IDs and resolve names */
  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
    // Remove deselected members from the name map
    setSelectedNameMap((prev) => {
      const next = new Map(prev);
      for (const key of prev.keys()) {
        if (!ids.includes(key)) {
          next.delete(key);
        }
      }
      return next;
    });
  }, []);

  /** Remove a per-booking recipient via the preview X button */
  const handleRemoveRecipient = useCallback((tmId: string) => {
    setSelectedIds((prev) => prev.filter((id) => id !== tmId));
  }, []);

  /** Render each item in the dropdown — also captures names for the preview */
  const renderItem = useCallback(
    (item: ModelFilterItem) => {
      // Capture the resolved name so the preview can display it
      const name = resolveTeamMemberName(item, true);
      if (!selectedNameMap.has(item.id)) {
        // Use a microtask to avoid setState during render
        queueMicrotask(() => {
          setSelectedNameMap((prev) => {
            if (prev.has(item.id)) return prev;
            const next = new Map(prev);
            next.set(item.id, resolveTeamMemberName(item));
            return next;
          });
        });
      }
      return name;
    },
    [selectedNameMap]
  );

  // Build the notification preview
  const previewRecipients = useMemo(() => {
    const recipients: Array<{ id?: string; name: string; reason: string }> = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    if (custodianName) {
      recipients.push({ name: custodianName, reason: "custodian" });
      seenNames.add(custodianName);
    }

    if (
      bookingSettings?.notifyBookingCreator &&
      creatorName &&
      !seenNames.has(creatorName)
    ) {
      recipients.push({ name: creatorName, reason: "creator" });
      seenNames.add(creatorName);
    }

    if (bookingSettings?.alwaysNotifyTeamMembers) {
      for (const tm of bookingSettings.alwaysNotifyTeamMembers) {
        const name = resolveTeamMemberName(tm);
        if (!seenIds.has(tm.id) && !seenNames.has(name)) {
          recipients.push({ name, reason: "always_notify" });
          seenIds.add(tm.id);
          seenNames.add(name);
        }
      }
    }

    for (const tmId of selectedIds) {
      if (seenIds.has(tmId)) continue;
      const name = selectedNameMap.get(tmId) ?? tmId;
      if (seenNames.has(name)) continue;
      recipients.push({
        id: tmId,
        name,
        reason: "booking_recipient",
      });
      seenIds.add(tmId);
      seenNames.add(name);
    }

    return recipients;
  }, [
    custodianName,
    creatorName,
    bookingSettings,
    selectedIds,
    selectedNameMap,
  ]);

  if (!isAdminOrOwner) {
    return null;
  }

  return (
    <FormRow
      rowLabel="Notifications"
      className="mobile-styling-only border-b-0 p-0"
    >
      <div className="w-full">
        <DynamicDropdown
          key={selectedIds.join(",")}
          trigger={
            <div
              className={`flex h-10 w-full items-center justify-between rounded border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50${
                _disabled ? " pointer-events-none opacity-50" : ""
              }`}
            >
              <span className="truncate text-gray-500">
                {(() => {
                  const count = previewRecipients.filter(
                    (r) => r.reason === "booking_recipient"
                  ).length;
                  return count > 0
                    ? `${count} user${count !== 1 ? "s" : ""} selected`
                    : "Add notification recipients...";
                })()}
              </span>
              <ChevronDownIcon className="size-4 shrink-0 text-gray-400" />
            </div>
          }
          triggerWrapperClassName="w-full"
          hideCounter
          className="w-full"
          style={{ width: "var(--radix-popover-trigger-width)" }}
          model={{
            name: "teamMember",
            queryKey: "name",
            deletedAt: null,
            userWithAdminAndOwnerOnly: true,
            usersOnly: true,
          }}
          initialDataKey="teamMembersForNotify"
          countKey="totalTeamMembersForNotify"
          selectionMode="none"
          defaultValues={selectedIds}
          onSelectionChange={handleSelectionChange}
          renderItem={renderItem}
          label="Notification recipients"
          placeholder="Search team members..."
        />
        <p className="mt-1.5 text-[13px] text-gray-500">
          Only administrators can be added.
        </p>

        {/* Hidden input for form submission — comma-separated team member IDs */}
        <input
          type="hidden"
          name="notificationRecipientIds"
          value={selectedIds.join(",")}
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
          onRemoveRecipient={handleRemoveRecipient}
        />
      </div>
    </FormRow>
  );
}
