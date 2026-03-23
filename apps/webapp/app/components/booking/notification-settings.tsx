/**
 * Workspace-level booking notification settings component.
 *
 * Rendered in Settings > Bookings. Provides three controls for configuring
 * who receives email notifications for bookings across the entire workspace:
 *
 * 1. **Notify booking creator** — auto-submit toggle
 * 2. **Notify admins on new booking requests** — auto-submit toggle
 * 3. **Always notify these users** — Popover-based team member picker with UserBadge pills
 *
 * @module
 */
import { useCallback, useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon, Search } from "lucide-react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import z from "zod";
import FormRow from "~/components/forms/form-row";
import { Switch } from "~/components/forms/switch";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { Spinner } from "~/components/shared/spinner";
import { UserBadge } from "~/components/shared/user-badge";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";

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

/** Shape of a team member eligible for notification selection. */
type TeamMemberForNotify = {
  id: string;
  name: string;
  user?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePicture: string | null;
  } | null;
};

/** Subset of workspace booking settings relevant to notification configuration. */
type BookingSettings = {
  notifyBookingCreator: boolean;
  notifyAdminsOnNewBooking: boolean;
  alwaysNotifyTeamMembers: TeamMemberForNotify[];
};

/**
 * Workspace-level notification settings card.
 *
 * @param bookingSettings - Current workspace-level notification settings
 * @param teamMembersForNotify - All eligible team members (admins/owners only)
 */
export function NotificationSettings({
  bookingSettings,
  teamMembersForNotify,
}: {
  bookingSettings: BookingSettings;
  teamMembersForNotify: TeamMemberForNotify[];
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

  const [selectedIds, setSelectedIds] = useState<string[]>(
    bookingSettings.alwaysNotifyTeamMembers.map((tm) => tm.id)
  );
  const [searchQuery, setSearchQuery] = useState("");

  /** Map for quick team member lookups by ID */
  const teamMemberMap = useMemo(() => {
    const map = new Map<string, TeamMemberForNotify>();
    for (const tm of teamMembersForNotify) {
      map.set(tm.id, tm);
    }
    return map;
  }, [teamMembersForNotify]);

  /** Selected team member objects for displaying UserBadge pills */
  const selectedMembers = useMemo(
    () =>
      selectedIds
        .map((id) => teamMemberMap.get(id))
        .filter(Boolean) as TeamMemberForNotify[],
    [selectedIds, teamMemberMap]
  );

  /** Filtered team members for search in the popover */
  const filteredMembers = useMemo(() => {
    if (!searchQuery) return teamMembersForNotify;
    const q = searchQuery.toLowerCase().trim();
    return teamMembersForNotify.filter(
      (tm) =>
        tm.name.toLowerCase().includes(q) ||
        tm.user?.firstName?.toLowerCase().includes(q) ||
        tm.user?.lastName?.toLowerCase().includes(q) ||
        tm.user?.email?.toLowerCase().includes(q)
    );
  }, [teamMembersForNotify, searchQuery]);

  const handleToggle = useCallback((tmId: string) => {
    setSelectedIds((prev) =>
      prev.includes(tmId) ? prev.filter((id) => id !== tmId) : [...prev, tmId]
    );
  }, []);

  return (
    <Card className="mt-0 overflow-visible">
      <div className="mb-4 border-b pb-4">
        <h3 className="text-text-lg font-semibold">
          Email Notification Recipients
        </h3>
        <p className="text-sm text-gray-600">
          Control who receives email notifications for bookings in this
          workspace.
        </p>
      </div>

      {/* Info callout */}
      <div className="mb-6 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
        The booking custodian always receives all notifications. These settings
        control who else gets notified. You can also add per-booking recipients
        when creating or editing a booking.
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

      {/* Popover-based team member picker for "always notify" list */}
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
          className="border-b-0 pb-[10px] pt-0"
        >
          <div className="w-full md:w-[512px]">
            {/* Popover trigger with inline UserBadge pills + floating dropdown */}
            <Popover
              onOpenChange={() => {
                setSearchQuery("");
              }}
            >
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm hover:bg-gray-50"
                >
                  {selectedMembers.length > 0 ? (
                    <span className="flex flex-1 flex-wrap items-center gap-1">
                      {selectedMembers.map((tm) => (
                        <UserBadge
                          key={tm.id}
                          img={tm.user?.profilePicture}
                          name={resolveTeamMemberName(tm, true)}
                        />
                      ))}
                    </span>
                  ) : (
                    <span className="text-gray-500">Select users...</span>
                  )}
                  <ChevronDownIcon className="size-4 shrink-0 text-gray-400" />
                </button>
              </PopoverTrigger>
              <PopoverPortal>
                <PopoverContent
                  align="start"
                  sideOffset={4}
                  className={tw(
                    "z-[999999] max-h-[300px] w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg md:w-[512px]"
                  )}
                >
                  {/* Search input */}
                  <div className="flex items-center border-b px-3">
                    <Search className="size-4 text-gray-500" />
                    <input
                      placeholder="Search..."
                      className="w-full border-0 p-2 text-[14px] focus:border-0 focus:ring-0"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>

                  {/* Scrollable member list */}
                  <div className="max-h-[240px] overflow-auto">
                    {filteredMembers.length === 0 ? (
                      <p className="px-4 py-3 text-[14px] text-gray-500">
                        No users found
                      </p>
                    ) : (
                      filteredMembers.map((tm) => {
                        const isSelected = selectedIds.includes(tm.id);
                        return (
                          <div
                            key={tm.id}
                            role="option"
                            aria-selected={isSelected}
                            tabIndex={0}
                            className={tw(
                              "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-[14px] hover:bg-gray-50",
                              isSelected && "bg-gray-50"
                            )}
                            onClick={() => handleToggle(tm.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleToggle(tm.id);
                              }
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <img
                                className="size-6 rounded-full"
                                alt=""
                                src={
                                  tm.user?.profilePicture ||
                                  "/static/images/default_pfp.jpg"
                                }
                              />
                              <div>
                                <p className="font-medium text-gray-700">
                                  {resolveTeamMemberName(tm, true)}
                                </p>
                                {tm.user?.email && (
                                  <p className="text-xs text-gray-500">
                                    {tm.user.email}
                                  </p>
                                )}
                              </div>
                            </div>
                            {isSelected && (
                              <CheckIcon className="size-4 text-primary" />
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </PopoverContent>
              </PopoverPortal>
            </Popover>

            {/* Hidden input for form submission */}
            <input
              type="hidden"
              name="alwaysNotifyTeamMemberIds"
              value={selectedIds.join(",")}
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
