import { OrganizationType } from "@prisma/client";
import { EXPLICIT_REQUIREMENT_LABELS } from "@shelf/labels";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useLoaderData } from "react-router";
import { z } from "zod";
import {
  ApprovalSettings,
  ApprovalSettingsSchema,
} from "~/components/booking/approval/approval-settings";
import {
  AutoArchiveSettings,
  AutoArchiveDaysSchema,
  AutoArchiveExpiredToggleSchema,
  AutoArchiveToggleSchema,
} from "~/components/booking/auto-archive-settings";
import {
  ExplicitCheckinSettings,
  ExplicitCheckinSettingsSchema,
} from "~/components/booking/explicit-checkin-settings";
import {
  ExplicitCheckoutSettings,
  ExplicitCheckoutSettingsSchema,
} from "~/components/booking/explicit-checkout-settings";
import { NotificationSettings } from "~/components/booking/notification-settings";
import { PdfTemplatesSettings } from "~/components/booking/pdf-templates-settings";
import {
  ProgressiveCheckinSettings,
  CountKitsAsUnitSettingsSchema,
} from "~/components/booking/progressive-checkin-settings";
import {
  TagsRequiredSettings,
  TagsRequiredSettingsSchema,
} from "~/components/booking/tags-required/tags-required-settings";
import {
  TimeSettings,
  TimeSettingsSchema,
} from "~/components/booking/time-settings";
import { ErrorContent } from "~/components/errors";
import type { HeaderData } from "~/components/layout/header/types";
import { Overrides } from "~/components/working-hours/overrides/overrides";
import { EnableWorkingHoursForm } from "~/components/working-hours/toggle-working-hours-form";
import { WeeklyScheduleForm } from "~/components/working-hours/weekly-schedule-form";
import { scheduleExpiryArchiveForExistingReservations } from "~/modules/booking/service.server";
import {
  getBookingSettingsForOrganization,
  updateAlwaysNotifyTeamMembers,
  updateBookingSettings,
} from "~/modules/booking-settings/service.server";
import {
  assertCanUsePdfTemplates,
  canUsePdfTemplates,
} from "~/modules/pdf-template/access";
import {
  AddTemplateFormSchema,
  PdfTemplateFormSchema,
  templateFromForm,
} from "~/modules/pdf-template/form";
import {
  createPdfTemplate,
  deletePdfTemplate,
  duplicatePdfTemplate,
  getPdfTemplateCustomFields,
  getPdfTemplates,
  setDefaultPdfTemplate,
  updatePdfTemplate,
} from "~/modules/pdf-template/service.server";
import { getTeamMembersForNotify } from "~/modules/team-member/service.server";
import {
  createWorkingHoursOverride,
  deleteWorkingHoursOverride,
  getWorkingHoursForOrganization,
  toggleWorkingHours,
  updateWorkingHoursSchedule,
} from "~/modules/working-hours/service.server";
import type { WeeklyScheduleJson } from "~/modules/working-hours/types";
import { parseWeeklyScheduleFromFormData } from "~/modules/working-hours/utils";
import {
  CreateOverrideFormSchema,
  WeeklyScheduleSchema,
  WorkingHoursToggleSchema,
} from "~/modules/working-hours/zod-utils";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { ShelfError, makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/** The PDF template intents; each needs a team workspace. */
const TEMPLATE_INTENTS = [
  "add-template",
  "save-template",
  "duplicate-template",
  "default-template",
  "delete-template",
];

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.workingHours,
      action: PermissionAction.update,
    });

    if (currentOrganization.type === OrganizationType.PERSONAL) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You are not allowed to access working hours in a personal workspace.",
        label: "Settings",
        shouldBeCaptured: false,
      });
    }

    // Only a team workspace has PDF templates; any other gets no card and
    // none of its templates are read.
    const showPdfTemplates = canUsePdfTemplates(currentOrganization);

    const [
      bookingSettings,
      workingHours,
      notifyData,
      pdfTemplates,
      templateCustomFields,
    ] = await Promise.all([
      getBookingSettingsForOrganization(organizationId),
      getWorkingHoursForOrganization(organizationId),
      getTeamMembersForNotify({ organizationId }),
      showPdfTemplates ? getPdfTemplates({ organizationId }) : [],
      // The custom fields a template can print, for its edit form.
      showPdfTemplates ? getPdfTemplateCustomFields({ organizationId }) : [],
    ]);

    const header: HeaderData = {
      title: "Bookings settings",
    };

    return payload({
      header,
      organization: currentOrganization,
      bookingSettings,
      workingHours,
      showPdfTemplates,
      pdfTemplates,
      templateCustomFields,
      ...notifyData,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const handle = {
  breadcrumb: () => "Bookings",
};

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export const ErrorBoundary = () => <ErrorContent />;

export type BookingSettingsActionData = typeof action;
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, access, currentOrganization } =
      await requirePermission({
        userId: authSession.userId,
        request,
        entity: PermissionEntity.workingHours,
        action: PermissionAction.update,
      });

    const formData = await request.formData();

    // Get intent manually to avoid any parseData issues with numeric keys in updateSchedule form data
    const intent = formData.get("intent") as string;
    if (
      !intent ||
      ![
        "updateTimeSettings",
        "updateTagsRequired",
        "updateBookingApproval",
        "updateAutoArchiveToggle",
        "updateAutoArchiveExpiredToggle",
        "updateAutoArchiveDays",
        "updateExplicitCheckin",
        "updateExplicitCheckout",
        "updateCountKitsAsSingleUnit",
        "updateNotifyBookingCreator",
        "updateNotifyAdminsOnNewBooking",
        "updateAlwaysNotifyTeamMembers",
        "toggle",
        "updateSchedule",
        "createOverride",
        "deleteOverride",
        ...TEMPLATE_INTENTS,
      ].includes(intent)
    ) {
      throw new ShelfError({
        cause: null,
        message: "Invalid action",
        additionalData: { intent },
        label: "Working hours",
      });
    }

    // Templates are team-only. This guard does not rely on the loader: a
    // hand-made POST from a personal workspace must not create or change one,
    // even on an install with premium features off.
    if (TEMPLATE_INTENTS.includes(intent)) {
      assertCanUsePdfTemplates(currentOrganization);
    }

    switch (intent) {
      case "updateTimeSettings": {
        const {
          bufferStartTime,
          maxBookingLength,
          maxBookingLengthSkipClosedDays,
        } = parseData(formData, TimeSettingsSchema, {
          additionalData: {
            intent,
            organizationId,
            formData: Object.fromEntries(formData),
          },
        });

        await updateBookingSettings({
          organizationId,
          bufferStartTime,
          maxBookingLength: maxBookingLength || null,
          maxBookingLengthSkipClosedDays,
        });

        sendNotification({
          title: "Settings updated",
          message: "Booking time restrictions have been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "updateTagsRequired": {
        const { tagsRequired } = parseData(
          formData,
          TagsRequiredSettingsSchema,
          {
            additionalData: {
              intent,
              organizationId,
              formData: Object.fromEntries(formData),
            },
          }
        );

        await updateBookingSettings({
          organizationId,
          tagsRequired,
        });

        sendNotification({
          title: "Settings updated",
          message: "Tags requirement setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "updateBookingApproval": {
        const { requireApprovalForBase, requireApprovalForSelfService } =
          parseData(formData, ApprovalSettingsSchema, {
            additionalData: {
              intent,
              organizationId,
              formData: Object.fromEntries(formData),
            },
          });

        // No sweep of existing reservations: every reservation written while
        // a switch is off carries `approvedAt` from `reserveBooking`, and the
        // bookings that predate the feature were stamped by migration
        // 20261102150100. Only genuine requests (made while a switch was on
        // and never decided) have no stamp, and those are pending again the
        // moment a switch comes back on, which is what they are.
        await updateBookingSettings({
          organizationId,
          requireApprovalForBase,
          requireApprovalForSelfService,
        });

        const gated = [
          requireApprovalForBase ? "Base" : null,
          requireApprovalForSelfService ? "Self service" : null,
        ].filter(Boolean);
        sendNotification({
          title: "Settings updated",
          message:
            gated.length > 0
              ? `New reservations by ${gated.join(
                  " and "
                )} users now wait for approval`
              : "Booking approval is off: every reservation is final at once",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "updateAutoArchiveToggle": {
        const { autoArchiveBookings } = parseData(
          formData,
          AutoArchiveToggleSchema,
          {
            additionalData: {
              intent,
              organizationId,
              formData: Object.fromEntries(formData),
            },
          }
        );

        await updateBookingSettings({
          organizationId,
          autoArchiveBookings,
        });

        sendNotification({
          title: "Settings updated",
          message: "Auto-archive setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "updateAutoArchiveExpiredToggle": {
        const { autoArchiveExpiredReservations } = parseData(
          formData,
          AutoArchiveExpiredToggleSchema,
          {
            additionalData: {
              intent,
              organizationId,
              formData: Object.fromEntries(formData),
            },
          }
        );

        await updateBookingSettings({
          organizationId,
          autoArchiveExpiredReservations,
        });

        // When turning the setting ON, schedule the archive job for every
        // currently-reserved booking so the existing backlog of past-due
        // reservations is cleaned up too — not just bookings reserved later.
        // Best-effort: the toggle is already saved, so a scheduler hiccup must
        // not fail the settings update. New reservations still schedule via the
        // reserve path, and the backlog re-schedules if the org re-toggles.
        if (autoArchiveExpiredReservations) {
          try {
            const settings =
              await getBookingSettingsForOrganization(organizationId);
            await scheduleExpiryArchiveForExistingReservations({
              organizationId,
              autoArchiveDays: settings.autoArchiveDays,
              hints: getClientHint(request),
            });
          } catch (cause) {
            Logger.error(
              new ShelfError({
                cause,
                message:
                  "Failed to schedule auto-archive for existing reservations",
                additionalData: { organizationId },
                label: "Booking Settings",
                shouldBeCaptured: false,
              })
            );
          }
        }

        sendNotification({
          title: "Settings updated",
          message: "Auto-archive setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "updateAutoArchiveDays": {
        const { autoArchiveDays } = parseData(formData, AutoArchiveDaysSchema, {
          additionalData: {
            intent,
            organizationId,
            formData: Object.fromEntries(formData),
          },
        });

        await updateBookingSettings({
          organizationId,
          autoArchiveDays,
        });

        sendNotification({
          title: "Settings updated",
          message: "Auto-archive days setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "toggle": {
        // Only use parseData for simple fields without numeric keys
        const { enableWorkingHours } = parseData(
          formData,
          WorkingHoursToggleSchema
        );

        await toggleWorkingHours({
          organizationId,
          enabled: enableWorkingHours,
        });

        sendNotification({
          title: "Workspace updated",
          message: "Your workspace has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      case "updateSchedule": {
        // CRITICAL: Do NOT use parseData here - it will fail with numeric keys
        // Parse manually using your utility function
        const weeklyScheduleData = parseWeeklyScheduleFromFormData(formData);

        // Validate directly with Zod (bypass parseData completely)
        const validation = WeeklyScheduleSchema.safeParse(weeklyScheduleData);

        if (!validation.success) {
          throw new ShelfError({
            cause: validation.error,
            title: "Invalid Schedule",
            message: "Please check your working hours schedule for errors",
            additionalData: {
              userId,
              organizationId,
              validationErrors: validation.error.errors.reduce(
                (acc, error) => {
                  const field = error.path.join(".");
                  acc[field] = error.message;
                  return acc;
                },
                {} as Record<string, string>
              ),
            },
            label: "Working hours",
          });
        }

        await updateWorkingHoursSchedule({
          organizationId,
          weeklySchedule: validation.data,
        });

        sendNotification({
          title: "Schedule updated",
          message: "Your weekly schedule has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }
      case "createOverride": {
        // Use parseData function following your standard pattern
        const validatedData = parseData(formData, CreateOverrideFormSchema);

        // Store the date as-is without timezone conversion
        // Working hours overrides should use absolute dates since they represent
        // real-world location-specific dates that don't change based on user timezone
        await createWorkingHoursOverride({
          organizationId,
          date: validatedData.date, // Store date directly without timezone adjustment
          isOpen: validatedData.isOpen,
          openTime: validatedData.openTime || undefined,
          closeTime: validatedData.closeTime || undefined,
          reason: validatedData.reason,
        });

        sendNotification({
          title: "Override created",
          message: "Working hours override has been created successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      case "deleteOverride": {
        const overrideId = formData.get("overrideId") as string;

        if (!overrideId) {
          throw new ShelfError({
            cause: null,
            message: "Override ID is required",
            additionalData: { intent },
            label: "Working hours",
          });
        }

        await deleteWorkingHoursOverride(overrideId, organizationId);

        sendNotification({
          title: "Override deleted",
          message: "Your working hours override has been deleted successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      // Toggle whether the booking creator receives email notifications for
      // bookings they create on behalf of another person (custodian).
      case "updateNotifyBookingCreator": {
        const notifyBookingCreator =
          formData.get("notifyBookingCreator") === "on";
        await updateBookingSettings({
          organizationId,
          notifyBookingCreator,
        });

        sendNotification({
          title: "Settings updated",
          message:
            "Booking creator notification setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      // Toggle whether all workspace admins are notified when a new booking is
      // reserved. Admins only receive the reservation notification, not
      // subsequent lifecycle events (checkout, checkin, etc.).
      case "updateNotifyAdminsOnNewBooking": {
        const notifyAdminsOnNewBooking =
          formData.get("notifyAdminsOnNewBooking") === "on";
        await updateBookingSettings({
          organizationId,
          notifyAdminsOnNewBooking,
        });

        sendNotification({
          title: "Settings updated",
          message: "Admin notification setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      // Replace the set of team members who always receive all booking
      // notifications for every booking in this workspace (e.g. office managers).
      // The IDs arrive as a comma-separated string from the MultiSelect component.
      case "updateAlwaysNotifyTeamMembers": {
        const teamMemberIdsString = formData.get(
          "alwaysNotifyTeamMemberIds"
        ) as string;
        const teamMemberIds = teamMemberIdsString
          ? teamMemberIdsString.split(",").filter(Boolean)
          : [];
        await updateAlwaysNotifyTeamMembers({
          organizationId,
          teamMemberIds,
        });

        sendNotification({
          title: "Settings updated",
          message: "Always-notify users have been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      case "updateExplicitCheckin": {
        // Only workspace owners can change explicit check-in settings
        if (!access.ownsWorkspace) {
          throw new ShelfError({
            cause: null,
            title: "Not allowed",
            message:
              "Only the workspace owner can change explicit check-in settings",
            status: 403,
            label: "Booking Settings",
            shouldBeCaptured: false,
          });
        }

        const {
          requireExplicitCheckinForAdmin,
          requireExplicitCheckinForSelfService,
        } = parseData(formData, ExplicitCheckinSettingsSchema, {
          additionalData: {
            intent,
            organizationId,
            formData: Object.fromEntries(formData),
          },
        });

        await updateBookingSettings({
          organizationId,
          requireExplicitCheckinForAdmin,
          requireExplicitCheckinForSelfService,
        });

        sendNotification({
          title: "Settings updated",
          message: "Explicit check-in settings have been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      case "updateExplicitCheckout": {
        // Only workspace owners can change explicit check-out settings
        if (!access.ownsWorkspace) {
          throw new ShelfError({
            cause: null,
            title: "Not allowed",
            message:
              "Only the workspace owner can change explicit check-out settings",
            status: 403,
            label: "Booking Settings",
            shouldBeCaptured: false,
          });
        }

        const {
          requireExplicitCheckoutForAdmin,
          requireExplicitCheckoutForSelfService,
        } = parseData(formData, ExplicitCheckoutSettingsSchema, {
          additionalData: {
            intent,
            organizationId,
            formData: Object.fromEntries(formData),
          },
        });

        await updateBookingSettings({
          organizationId,
          requireExplicitCheckoutForAdmin,
          requireExplicitCheckoutForSelfService,
        });

        sendNotification({
          title: "Settings updated",
          message: "Explicit check-out settings have been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      case "updateCountKitsAsSingleUnit": {
        const { countKitsAsSingleUnit } = parseData(
          formData,
          CountKitsAsUnitSettingsSchema,
          {
            additionalData: {
              intent,
              organizationId,
              formData: Object.fromEntries(formData),
            },
          }
        );

        await updateBookingSettings({
          organizationId,
          countKitsAsSingleUnit,
        });

        sendNotification({
          title: "Settings updated",
          message:
            "Progressive check-in counting setting has been updated successfully",
          icon: { name: "success", variant: "success" },
          senderId: authSession.userId,
        });

        return data(payload({ success: true }), { status: 200 });
      }

      case "add-template": {
        const { name } = parseData(formData, AddTemplateFormSchema, {
          additionalData: { userId, organizationId },
        });
        const template = await createPdfTemplate({ organizationId, name });
        sendNotification({
          title: "Template added",
          message: `"${template.name}" is ready to set up.`,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
        return payload({ templateId: template.id });
      }
      case "save-template": {
        const form = parseData(formData, PdfTemplateFormSchema, {
          additionalData: { userId, organizationId },
        });
        const { name, config } = templateFromForm(form);
        await updatePdfTemplate({
          organizationId,
          templateId: form.templateId,
          name,
          config,
        });
        sendNotification({
          title: "Template saved",
          message: `"${name}" prints with the new settings.`,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });
        return payload({ templateId: form.templateId });
      }
      case "duplicate-template":
      case "default-template":
      case "delete-template": {
        const { templateId } = parseData(
          formData,
          z.object({ templateId: z.string().min(1) }),
          { additionalData: { userId, organizationId } }
        );
        if (intent === "duplicate-template") {
          await duplicatePdfTemplate({ organizationId, templateId });
        } else if (intent === "default-template") {
          await setDefaultPdfTemplate({ organizationId, templateId });
        } else {
          await deletePdfTemplate({ organizationId, templateId });
        }
        return payload({ templateId });
      }

      default: {
        throw new ShelfError({
          cause: null,
          message: "Invalid action",
          additionalData: { intent },
          label: "Working hours",
        });
      }
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
export default function GeneralPage() {
  const {
    workingHours,
    bookingSettings,
    showPdfTemplates,
    pdfTemplates,
    templateCustomFields,
  } = useLoaderData<typeof loader>();

  return (
    <>
      {/* Email notification recipient settings */}
      <NotificationSettings bookingSettings={bookingSettings} />

      {/* Booking approval settings form */}
      <ApprovalSettings
        header={{
          title: "Booking approval",
          subHeading:
            "Choose which roles' reservations wait for an administrator or manager to say yes before the gear goes out.",
        }}
        defaultValues={{
          requireApprovalForBase: bookingSettings.requireApprovalForBase,
          requireApprovalForSelfService:
            bookingSettings.requireApprovalForSelfService,
        }}
      />

      {/* Explicit check-in settings form */}
      <ExplicitCheckinSettings
        header={{
          title: EXPLICIT_REQUIREMENT_LABELS.CHECKIN.TITLE,
          subHeading:
            "Switch on a role to remove its one-click check-in. That role checks items in by scanning them or by selecting them from the list, on the web and on the phone. Only the workspace owner can change this setting.",
        }}
        defaultValues={{
          requireExplicitCheckinForAdmin:
            bookingSettings.requireExplicitCheckinForAdmin,
          requireExplicitCheckinForSelfService:
            bookingSettings.requireExplicitCheckinForSelfService,
        }}
      />

      {/* Explicit check-out settings form */}
      <ExplicitCheckoutSettings
        header={{
          title: EXPLICIT_REQUIREMENT_LABELS.CHECKOUT.TITLE,
          subHeading:
            "Switch on a role to remove its one-click check-out. That role checks items out by scanning them or by selecting them from the list, on the web and on the phone. Only the workspace owner can change this setting.",
        }}
        defaultValues={{
          requireExplicitCheckoutForAdmin:
            bookingSettings.requireExplicitCheckoutForAdmin,
          requireExplicitCheckoutForSelfService:
            bookingSettings.requireExplicitCheckoutForSelfService,
        }}
      />

      {/* Progressive check-in/out display options group */}
      <div>
        <ProgressiveCheckinSettings
          header={{
            title: "Counting options",
            subHeading:
              "Choose how kits are counted when visualising booking check-in/out progress.",
          }}
          defaultValue={bookingSettings.countKitsAsSingleUnit}
        />
      </div>

      {/* Tags required settings form */}
      <TagsRequiredSettings
        header={{
          title: "Tags requirement",
          subHeading:
            "Control whether users must add tags to their bookings. This helps with categorization and organization of bookings.",
        }}
        defaultValue={bookingSettings.tagsRequired}
      />

      {/* Auto-archive settings form */}
      <AutoArchiveSettings
        header={{
          title: "Automation",
          subHeading:
            "Configure automatic actions for completed bookings to keep your workspace clean.",
        }}
        defaultAutoArchiveBookings={bookingSettings.autoArchiveBookings}
        defaultAutoArchiveExpiredReservations={
          bookingSettings.autoArchiveExpiredReservations
        }
        defaultAutoArchiveDays={bookingSettings.autoArchiveDays}
      />

      {/* Time settings form */}
      <TimeSettings
        header={{
          title: "Booking time restrictions",
          subHeading:
            "Control booking timing constraints including minimum advance notice and maximum booking duration.",
        }}
        defaultBufferValue={bookingSettings.bufferStartTime}
        defaultMaxLengthValue={bookingSettings.maxBookingLength}
        defaultMaxBookingLengthSkipClosedDays={
          bookingSettings.maxBookingLengthSkipClosedDays
        }
      />

      {/* Enable working hours form */}
      <EnableWorkingHoursForm
        enabled={workingHours.enabled}
        header={{
          title: "Working hours",
          subHeading:
            "Manage your workspace's working hours. This will allow you to limit when bookings' start and end times and dates.",
        }}
      />
      {/* New weekly schedule form - only show if working hours are enabled */}
      {workingHours.enabled && (
        <WeeklyScheduleForm
          weeklySchedule={
            workingHours.weeklySchedule as unknown as WeeklyScheduleJson
          }
        />
      )}
      {/* New weekly schedule form - only show if working hours are enabled */}
      {workingHours.enabled && <Overrides overrides={workingHours.overrides} />}

      {/* PDF templates: what a booking's PDF prints */}
      {showPdfTemplates ? (
        <PdfTemplatesSettings
          templates={pdfTemplates}
          customFields={templateCustomFields}
        />
      ) : null}
    </>
  );
}
