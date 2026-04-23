/**
 * Dialog for managing per-booking notification recipients.
 *
 * Opened from the booking Actions dropdown. Allows admin/owner users to
 * select which team members should receive email notifications for this
 * specific booking. Uses the same DynamicDropdown + NotificationPreview
 * pattern as the inline field in the create-booking form.
 *
 * Follows the same dialog lifecycle as ExtendBookingDialog:
 * trigger button → local open state → fetcher form → auto-close on success.
 *
 * @module
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { BellIcon, ChevronDownIcon } from "lucide-react";
import { useLoaderData } from "react-router";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { ModelFilterItem } from "~/hooks/use-model-filters";
import type { BookingPageLoaderData } from "~/routes/_layout+/bookings.$bookingId.overview";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { resolveTeamMemberName } from "~/utils/user";
import type { NotificationRecipientTeamMember } from "./forms/fields/notification-recipients";
import { NotificationPreview } from "./notification-preview";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

/**
 * Dialog for managing per-booking notification recipients.
 * Triggered from the booking Actions dropdown.
 */
export default function ManageNotificationsDialog() {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcherWithReset<DataOrErrorResponse>();
  const disabled = useDisabled(fetcher);
  const { booking } = useLoaderData<BookingPageLoaderData>();
  const bookingSettings = useBookingSettings();

  const defaultRecipients = (booking.notificationRecipients ??
    []) as NotificationRecipientTeamMember[];

  const [selectedIds, setSelectedIds] = useState<string[]>(
    defaultRecipients.map((tm) => tm.id)
  );
  const [selectedNameMap, setSelectedNameMap] = useState<Map<string, string>>(
    () => {
      const map = new Map<string, string>();
      defaultRecipients.forEach((tm) =>
        map.set(tm.id, resolveTeamMemberName(tm))
      );
      return map;
    }
  );

  function handleOpen() {
    // Reset to current saved state when opening
    setSelectedIds(defaultRecipients.map((tm) => tm.id));
    setOpen(true);
  }

  const handleClose = useCallback(() => {
    setOpen(false);
    fetcher.reset();
  }, [fetcher]);

  useEffect(
    function closeOnSuccess() {
      const data = fetcher?.data;
      if (data && "success" in data && data.success) {
        handleClose();
      }
    },
    [fetcher?.data, handleClose]
  );

  /** When DynamicDropdown selection changes */
  const handleSelectionChange = useCallback((ids: string[]) => {
    setSelectedIds(ids);
  }, []);

  /** Remove a per-booking recipient via the preview X button */
  const handleRemoveRecipient = useCallback((tmId: string) => {
    setSelectedIds((prev) => prev.filter((id) => id !== tmId));
  }, []);

  /** Capture names from rendered items for the preview */
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

  /** Custodian display name */
  const custodianName = booking.custodianUser
    ? resolveTeamMemberName({
        name: "",
        user: booking.custodianUser,
      })
    : booking.custodianTeamMember?.name ?? "";

  /** Creator display name */
  const creatorName = booking.creator
    ? resolveTeamMemberName({ name: "", user: booking.creator })
    : undefined;

  /** Build preview recipients */
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

  return (
    <>
      <Button
        type="button"
        variant="link"
        className="justify-start rounded px-2 py-1.5 text-sm font-medium text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
        width="full"
        onClick={handleOpen}
      >
        Manage notifications
      </Button>

      <DialogPortal>
        <Dialog
          className="lg:max-w-[500px]"
          open={open}
          onClose={handleClose}
          title={
            <div className="flex size-10 items-center justify-center rounded-full bg-primary-25">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary-50">
                <BellIcon className="size-4 text-primary-500" />
              </div>
            </div>
          }
        >
          <div className="px-6 pb-4">
            <h3 className="mb-1">Manage notifications</h3>
            <p className="mb-4 text-sm text-gray-600">
              Choose who receives email notifications for this booking.
            </p>

            <fetcher.Form method="POST">
              <div className="mb-4">
                <DynamicDropdown
                  key={selectedIds.join(",")}
                  trigger={
                    <div className="flex h-10 w-full items-center justify-between rounded border border-gray-300 bg-white px-3 text-sm hover:bg-gray-50">
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
              </div>

              <NotificationPreview
                recipients={previewRecipients}
                adminCount={0}
                notifyAdminsOnNewBooking={
                  bookingSettings?.notifyAdminsOnNewBooking ?? true
                }
                onRemoveRecipient={handleRemoveRecipient}
              />

              <input
                type="hidden"
                name="notificationRecipientIds"
                value={selectedIds.join(",")}
              />
              <input
                type="hidden"
                name="intent"
                value="updateNotificationRecipients"
              />

              <div className="mt-4 flex items-center gap-2">
                <Button
                  disabled={disabled}
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={disabled}>
                  Save
                </Button>
              </div>
            </fetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
