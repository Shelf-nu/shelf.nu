/**
 * API Route: Create a booking from selected asset models.
 *
 * The write side of the asset index's model view "Book selection → New
 * booking" flow. The submission carries the booking's own fields plus one
 * `{ assetModelId, quantity }` pair per selected model, and the booking is
 * created holding those units as `BookingModelRequest` reservations.
 *
 * **Reservations are not assets.** Nothing concrete is picked here: the
 * booking promises N units of a model and the physical assets are resolved
 * later, through scan-to-assign. So `createBooking` is called with an empty
 * `assetIds` — sending the models' assets would hand the booking units the
 * user never chose.
 *
 * The booking and its reservations commit together inside `createBooking`'s
 * own transaction, and a model whose pool cannot cover its quantity aborts the
 * whole create. A user therefore never lands on a booking holding part of what
 * they asked for.
 *
 * Errors are RETURNED, not thrown, so the dialog that posts here can render
 * them in place instead of losing the form to an error boundary.
 *
 * @see {@link file://./../../components/assets/assets-index/model-booking/create-booking-for-models-dialog.tsx} — the dialog that posts here
 * @see {@link file://./../../modules/booking/service.server.ts} — `createBooking`, which writes the reservations
 */

import { data, redirect, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import { modelReservationsField } from "~/modules/asset-model/model-reservations-schema";
import { createBooking } from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { buildTagsSet } from "~/modules/tag/service.server";
import { getTeamMember } from "~/modules/team-member/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { assertIsPost, error, parseData } from "~/utils/http.server";
import { assertAssetModelsBelongToOrg } from "~/utils/org-validation.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * The models to reserve, as the dialog submits them.
 *
 * Posted as indexed form fields (`models[0].assetModelId`,
 * `models[0].quantity`, …), which `parseData` turns back into an array before
 * this schema sees it. Quantities arrive as strings from the form, hence the
 * coercion.
 *
 * Parsed on its own rather than folded into {@link BookingFormSchema} so an
 * empty or malformed selection is reported before the org's working-hours and
 * booking settings are loaded — the models are what this route exists for.
 *
 * Exported so the dialog and tests validate against the same shape. The
 * `models` field itself is shared with the add-to-existing route.
 */
export const CreateBookingForModelsSchema = z.object({
  models: modelReservationsField("Select at least one model to book."),
});

/**
 * Creates a booking holding model-level reservations for the selected models.
 *
 * @param args.request - POST carrying the booking fields and the `models` array
 * @returns A redirect to the new booking's overview, or an error response
 *   carrying the validation errors for the dialog to render
 */
export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const { organizationId, currentOrganization, isSelfServiceOrBase } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.create,
      });

    // Personal workspaces have no bookings at all. The model view's control is
    // hidden there, but a crafted POST does not go through the UI.
    if (isPersonalOrg(currentOrganization)) {
      throw new ShelfError({
        cause: null,
        title: "Not allowed",
        message:
          "You can't create bookings for personal workspaces. Please create a Team workspace to create bookings.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    const formData = await request.formData();

    const { models } = parseData(formData, CreateBookingForModelsSchema, {
      // A selection the user made and a quantity they typed — a 400, not a
      // server fault.
      shouldBeCaptured: false,
      additionalData: { userId, organizationId },
    });

    // The ids come straight from a bulk selection, so they are request input
    // and prove nothing about which workspace they belong to. The reservation
    // write refuses a foreign model too, but it does so one model into a
    // transaction; refusing the batch here names the problem while the whole
    // submission is still on the table.
    await assertAssetModelsBelongToOrg({
      assetModelIds: models.map((model) => model.assetModelId),
      organizationId,
    });

    // The typed wall-clock dates are read in the acting user's RESOLVED
    // preference zone — the same zone that displayed them — so validation and
    // storage agree with what the user saw.
    const prefs = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );
    const [workingHours, bookingSettings] = await Promise.all([
      getWorkingHoursForOrganization(organizationId),
      getBookingSettingsForOrganization(organizationId),
    ]);

    const {
      name,
      custodian,
      description,
      tags: commaSeparatedTags,
      // The schema's coerced instants, not the raw fields: `coerceLocalDate`
      // accepts second precision that a re-parse of the minute-only form value
      // would turn into an Invalid Date.
      startDate: from,
      endDate: to,
    } = parseData(
      formData,
      BookingFormSchema({
        prefs,
        action: "new",
        workingHours,
        bookingSettings,
        // ADMIN/OWNER are not held to the buffer-start and max-length limits.
        isAdminOrOwner: !isSelfServiceOrBase,
      }),
      {
        // Working-hours and buffer messages are expected user-input feedback.
        shouldBeCaptured: false,
        additionalData: { userId, organizationId },
      }
    );

    const custodianFromDb = await getTeamMember({
      id: custodian.id,
      organizationId,
      select: { id: true, userId: true },
    }).catch((cause) => {
      throw new ShelfError({
        cause,
        title: "Team member not found",
        message: "The selected team member could not be found.",
        additionalData: { userId, custodian },
        label: "Booking",
        status: 404,
      });
    });

    // BASE and SELF_SERVICE users book for themselves only.
    if (isSelfServiceOrBase && custodianFromDb.userId !== userId) {
      throw new ShelfError({
        cause: null,
        message: "Self user can assign booking to themselves only.",
        label: "Booking",
        status: 403,
        shouldBeCaptured: false,
      });
    }

    // `BookingFormSchema` returns a union across its action branches, so both
    // dates widen to `Date | undefined` even though the "new" branch requires
    // them. A missing date is a 400, never an Invalid Date handed to the
    // service.
    if (!from || !to) {
      throw new ShelfError({
        cause: null,
        message: "Booking start and end dates are required.",
        additionalData: { userId, organizationId },
        label: "Booking",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    const booking = await createBooking({
      booking: {
        from,
        to,
        custodianTeamMemberId: custodian.id,
        custodianUserId: custodianFromDb.userId ?? null,
        name,
        description: description ?? null,
        organizationId,
        creatorId: userId,
        tags: buildTagsSet(commaSeparatedTags).set,
      },
      // Empty by design — this booking holds reservations, not assets.
      assetIds: [],
      modelRequests: models,
      hints: getClientHint(request),
    });

    sendNotification({
      title: "Booking saved",
      message: "Your booking has been saved successfully",
      icon: { name: "success", variant: "success" },
      senderId: userId,
    });

    // Straight to the overview, not the manage-assets flow an asset-less
    // booking would normally land on: this booking is not empty, it holds
    // reservations, and the overview is where they are listed.
    return redirect(`/bookings/${booking.id}/overview`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
