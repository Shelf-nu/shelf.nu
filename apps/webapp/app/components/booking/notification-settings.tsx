/**
 * Workspace-level booking notification settings component.
 *
 * Rendered in Settings > Bookings. Provides three controls for configuring
 * who receives email notifications for bookings across the entire workspace:
 *
 * 1. **Notify booking creator** — auto-submit toggle
 * 2. **Notify admins on new booking requests** — auto-submit toggle
 * 3. **Always notify these users** — DynamicDropdown picker with explicit save
 *
 * @module
 */
import { useCallback, useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Spinner } from "~/components/shared/spinner";
import { useDisabled } from "~/hooks/use-disabled";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import { resolveTeamMemberName } from "~/utils/user";
import { NotificationPreview } from "./notification-preview";

/** Zod schema for the "notify booking creator" toggle form. */
export const NotifyBookingCreatorSchema = z.object({
  notifyBookingCreator: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

/** Zod schema for the "notify admins on new booking" toggle form. */
export const NotifyAdminsOnNewBookingSchema = z.object({
  notifyAdminsOnNewBooking: z
    .string()
    .transform((val) => val === "on")
    .default("false"),
});

/** Subset of workspace booking settings relevant to notification configuration. */
type BookingSettings = {
  notifyBookingCreator: boolean;
  notifyAdminsOnNewBooking: boolean;
  alwaysNotifyTeamMembers: Array<{ id: string; name: string }>;
};

/**
 * Workspace-level notification settings card.
 *
 * @param bookingSettings - Current workspace-level notification settings
 */
export function NotificationSettings({
  bookingSettings,
}: {
  bookingSettings: BookingSettings;
}) {
  const creatorFetcher = useFetcher();
  const adminsFetcher = useFetcher();
  const alwaysNotifyFetcher = useFetcher();

  const creatorZo = useZorm(
    "NotifyBookingCreatorForm",
    NotifyBookingCreatorSchema
  );
  const adminsZo = useZorm(
    "NotifyAdminsOnNewBookingForm",
    NotifyAdminsOnNewBookingSchema
  );

  const creatorDisabled = useDisabled(creatorFetcher);
  const adminsDisabled = useDisabled(adminsFetcher);
  const alwaysNotifyDisabled = useDisabled(alwaysNotifyFetcher);

  // Track both current and initial selection to detect unsaved changes
  const initialIds = bookingSettings.alwaysNotifyTeamMembers.map((tm) => tm.id);
  const [selectedIds, setSelectedIds] = useState<string[]>(initialIds);
  const hasUnsavedChanges =
    selectedIds.length !== initialIds.length ||
    selectedIds.some((id) => !initialIds.includes(id));

  // Name map for the preview — seeded from saved always-notify members,
  // updated as new members are selected in the dropdown
  const [selectedNameMap, setSelectedNameMap] = useState<Map<string, string>>(
    () => {
      const map = new Map<string, string>();
      bookingSettings.alwaysNotifyTeamMembers.forEach((tm) =>
        map.set(tm.id, resolveTeamMemberName(tm))
      );
      return map;
    }
  );

  /** Render dropdown items and capture names for the preview */
  const renderItem = useCallback(
    (item: ModelFilterItem) => {
      const name = resolveTeamMemberName(item, true);
      if (!selectedNameMap.has(item.id)) {
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

  /** Remove a member via the preview X button */
  const handleRemove = useCallback((tmId: string) => {
    setSelectedIds((prev) => prev.filter((id) => id !== tmId));
  }, []);

  /** Build preview list from selected IDs */
  const previewRecipients = useMemo(
    () =>
      selectedIds.map((tmId) => ({
        id: tmId,
        name: selectedNameMap.get(tmId) ?? tmId,
        reason: "always_notify" as const,
      })),
    [selectedIds, selectedNameMap]
  );

  return (
    <Card className="mt-0 overflow-visible">
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">
          Email Notification Recipients
        </h3>
        <p className="text-sm text-gray-600">
          The booking custodian always receives all notifications. These
          settings control who else gets notified. You can also add per-booking
          recipients when creating or editing a booking.
        </p>
      </div>

      {/* Toggle: Notify booking creator */}
      <creatorFetcher.Form
        ref={creatorZo.ref}
        method="post"
        onChange={(e) => {
          void creatorFetcher.submit(e.currentTarget);
        }}
      >
        <FormRow
          rowLabel="Notify booking creator"
          subHeading={
            <div>
              When someone creates a booking on behalf of another person, the
              creator will receive all email updates for that booking.
            </div>
          }
          className="border-b-0 pb-[10px] pt-0"
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={creatorZo.fields.notifyBookingCreator()}
              disabled={creatorDisabled}
              defaultChecked={bookingSettings.notifyBookingCreator}
              title="Notify booking creator"
            />
          </div>
        </FormRow>
        <input type="hidden" value="updateNotifyBookingCreator" name="intent" />
      </creatorFetcher.Form>

      {/* Toggle: Notify all admins on new booking requests */}
      <adminsFetcher.Form
        ref={adminsZo.ref}
        method="post"
        onChange={(e) => {
          void adminsFetcher.submit(e.currentTarget);
        }}
      >
        <FormRow
          rowLabel="Notify all admins on new booking requests"
          subHeading={
            <div>
              When a booking is reserved, all workspace admins receive a
              notification so someone can review and handle the request. Admins
              will not receive subsequent updates (checkout, checkin, etc.)
              unless they are added as a notification recipient on the booking.
            </div>
          }
          className="border-b-0 pb-[10px] pt-0"
        >
          <div className="flex flex-col items-center gap-2">
            <Switch
              name={adminsZo.fields.notifyAdminsOnNewBooking()}
              disabled={adminsDisabled}
              defaultChecked={bookingSettings.notifyAdminsOnNewBooking}
              title="Notify all admins on new booking requests"
            />
          </div>
        </FormRow>
        <input
          type="hidden"
          value="updateNotifyAdminsOnNewBooking"
          name="intent"
        />
      </adminsFetcher.Form>

      {/* DynamicDropdown picker: Always notify these users */}
      <alwaysNotifyFetcher.Form method="post">
        <FormRow
          rowLabel="Always notify these users"
          subHeading={
            <div>
              These users receive all booking email notifications for every
              booking in this workspace. Use this for people who need complete
              visibility, like an office manager or operations lead.
            </div>
          }
          className="mt-4 border-b-0 pb-[10px] pt-0"
        >
          <div className="w-full md:w-[512px]">
            <DynamicDropdown
              key={selectedIds.join(",")}
              trigger={
                <div className="flex h-10 w-full items-center justify-between rounded border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50">
                  <span className="truncate text-gray-500">
                    {selectedIds.length > 0
                      ? `${selectedIds.length} user${
                          selectedIds.length !== 1 ? "s" : ""
                        } selected`
                      : "Select users..."}
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
              onSelectionChange={setSelectedIds}
              renderItem={renderItem}
              label="Always notify"
              placeholder="Search team members..."
            />

            <p className="mt-1.5 text-[13px] text-gray-500">
              Only administrators can be added.
            </p>

            {hasUnsavedChanges ? (
              <p className="mt-1.5 text-[13px] font-medium text-warning-600">
                You have unsaved changes.
              </p>
            ) : null}

            {/* Hidden input for form submission */}
            <input
              type="hidden"
              name="alwaysNotifyTeamMemberIds"
              value={selectedIds.join(",")}
            />

            <NotificationPreview
              recipients={previewRecipients}
              adminCount={0}
              notifyAdminsOnNewBooking={false}
              onRemoveRecipient={handleRemove}
            />
          </div>
        </FormRow>

        <div className="text-right">
          <Button
            type="submit"
            disabled={alwaysNotifyDisabled}
            value="updateAlwaysNotifyTeamMembers"
            name="intent"
          >
            {alwaysNotifyDisabled ? <Spinner /> : "Save notification settings"}
          </Button>
        </div>
      </alwaysNotifyFetcher.Form>
    </Card>
  );
}
