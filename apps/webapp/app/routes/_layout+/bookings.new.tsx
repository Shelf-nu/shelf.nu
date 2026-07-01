import { useAtomValue } from "jotai";
import { DateTime } from "luxon";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { dynamicTitleAtom } from "~/atoms/dynamic-title-atom";
import { BookingFormSchema } from "~/components/booking/forms/forms-schema";
import { NewBookingForm } from "~/components/booking/forms/new-booking-form";
import { newBookingHeader } from "~/components/booking/new-booking-header";
import Header from "~/components/layout/header";
import { db } from "~/database/db.server";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useUserData } from "~/hooks/use-user-data";
import { isQuantityTracked } from "~/modules/asset/utils";
import {
  buildKitSlicesForBooking,
  createBooking,
  updateBookingNotificationRecipients,
} from "~/modules/booking/service.server";
import { getBookingSettingsForOrganization } from "~/modules/booking-settings/service.server";
import { setSelectedOrganizationIdCookie } from "~/modules/organization/context.server";
import {
  buildTagsSet,
  getTagsForBookingTagsFilter,
} from "~/modules/tag/service.server";
import {
  getTeamMember,
  getTeamMemberForForm,
  getTeamMembersForNotify,
} from "~/modules/team-member/service.server";
import { getWorkingHoursForOrganization } from "~/modules/working-hours/service.server";
import styles from "~/styles/layout/bookings.new.css?url";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint, getHints } from "~/utils/client-hints";
import { DATE_TIME_FORMAT } from "~/utils/constants";
import { setCookie } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  parseData,
} from "~/utils/http.server";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type NewBookingLoaderReturnType = typeof loader;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const searchParams = getCurrentSearchParams(request);
  const assetIds = searchParams.getAll("assetId");
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization, isSelfServiceOrBase } =
      await requirePermission({
        userId: authSession?.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.create,
      });

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

    /**
     * We need to fetch the team members to be able to display them in the custodian dropdown.
     */
    const [teamMembersData, tagsData, notifyData] = await Promise.all([
      getTeamMemberForForm({
        organizationId,
        userId,
        isSelfServiceOrBase,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
      }),
      getTagsForBookingTagsFilter({
        organizationId,
      }),
      getTeamMembersForNotify({ organizationId }),
    ]);

    return data(
      payload({
        userId,
        currentOrganization,
        header: newBookingHeader,
        showModal: false,
        isSelfServiceOrBase,
        ...teamMembersData,
        // For consistency, also provide teamMembersForForm
        teamMembersForForm: teamMembersData.teamMembers,
        assetIds: assetIds.length ? assetIds : undefined,
        // Plain /bookings/new has no originating kit. The kit-create route
        // (kits.$kitId.assets.create-new-booking) reuses this default export
        // but overrides the loader, supplying a real kitId. Typing it here as
        // string | undefined lets the shared component read kitId for both
        // routes without a separate loader type.
        kitId: undefined as string | undefined,
        ...tagsData,
        ...notifyData,
      }),
      {
        headers: [
          setCookie(await setSelectedOrganizationIdCookie(organizationId)),
        ],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export type NewBookingActionReturnType = typeof action;

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, currentOrganization, isSelfServiceOrBase } =
      await requirePermission({
        userId: authSession?.userId,
        request,
        entity: PermissionEntity.booking,
        action: PermissionAction.create,
      });

    // SECURITY: mirror the loader guard on the action. Bookings cannot be
    // created in personal workspaces; without this check a crafted POST could
    // bypass the (loader-only) UI restriction.
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
    const intent = formData.get("intent") as string;
    const hints = getHints(request);
    const workingHours = await getWorkingHoursForOrganization(organizationId);
    const bookingSettings =
      await getBookingSettingsForOrganization(organizationId);

    // ADMIN/OWNER users bypass time restrictions (bufferStartTime, maxBookingLength)
    const isAdminOrOwner = !isSelfServiceOrBase;

    const payload = parseData(
      formData,
      BookingFormSchema({
        hints,
        action: "new",
        workingHours,
        bookingSettings,
        isAdminOrOwner,
      }),
      {
        // Expected user-input validation (e.g. "Start date must be at least N
        // hours from now") — a 400, not a server error. Don't capture to
        // Sentry (was noise: SHELF-WEBAPP-1KZ).
        shouldBeCaptured: false,
        additionalData: { userId, organizationId },
      }
    );

    const {
      name,
      custodian,
      assetIds,
      description,
      tags: commaSeparatedTags,
    } = payload;

    // Validate that the custodian belongs to the same organization
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

    /**
     * Validate if the user is self user and is assigning the booking to
     * him/herself only.
     */
    if (isSelfServiceOrBase && custodianFromDb.userId !== userId) {
      throw new ShelfError({
        cause: null,
        message: "Self user can assign booking to themselves only.",
        label: "Booking",
      });
    }

    const from = DateTime.fromFormat(
      formData.get("startDate")!.toString()!,
      DATE_TIME_FORMAT,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

    const to = DateTime.fromFormat(
      formData.get("endDate")!.toString()!,
      DATE_TIME_FORMAT,
      {
        zone: hints.timeZone,
      }
    ).toJSDate();

    const tags = buildTagsSet(commaSeparatedTags).set;

    /**
     * Kit ids submitted by the form when the booking is created FROM a kit
     * (kit detail → "Create new booking"). Read straight from the form rather
     * than via {@link BookingFormSchema} — the schema doesn't model `kitId`,
     * and we only need the raw ids to resolve kit memberships into slices.
     *
     * SECURITY (cross-org IDOR): these ids are user-supplied. We do NOT trust
     * them — `buildKitSlicesForBooking` resolves memberships scoped to
     * `organizationId`, and `createBooking` additionally re-validates every
     * slice's asset id and `AssetKit` id against the org before writing. So no
     * extra guard is needed here.
     */
    const kitIds = formData.getAll("kitId").map(String).filter(Boolean);

    // Resolve kit memberships into kit-driven slices and split the form's
    // asset ids into the two buckets `createBooking` expects:
    // - kit members → `kitSlices` (kit-grouped `BookingAsset` rows)
    // - everything else → `standaloneAssetIds` (loose rows, `assetKitId` NULL)
    // When no kit is involved, `standaloneAssetIds` is just the form's
    // `assetIds` and `kitSlices` stays empty (behavior unchanged).
    let kitSlices: Array<{
      assetId: string;
      assetKitId: string;
      quantity: number;
    }> = [];
    let standaloneAssetIds = assetIds?.length ? assetIds : [];

    if (kitIds.length > 0) {
      kitSlices = await buildKitSlicesForBooking({ kitIds, organizationId });
      // Fail fast when a kit-originated submission resolves to no slices (stale
      // page, deleted/emptied kit, or tampered input). The form pre-filled
      // `assetIds` with the kit's members, so silently falling through would
      // write them as loose standalone rows (assetKitId NULL) — breaking the
      // kit-slice invariant and re-opening the duplicate/count bugs this fixes.
      if (kitSlices.length === 0) {
        throw new ShelfError({
          cause: null,
          title: "Kit not found",
          message:
            "The selected kit could not be resolved. Please reload and try again.",
          label: "Booking",
          status: 409,
          shouldBeCaptured: false,
        });
      }
      const kitMemberIds = new Set(kitSlices.map((s) => s.assetId));
      // Subtract kit members so a kit member is never written as BOTH a kit
      // slice and a standalone row (which would duplicate it on the booking).
      standaloneAssetIds = standaloneAssetIds.filter(
        (id) => !kitMemberIds.has(id)
      );
    }

    const booking = await createBooking({
      booking: {
        from,
        to,
        custodianTeamMemberId: custodian.id,
        custodianUserId: custodian?.userId ?? null,
        name: name!,
        description: description ?? null,
        organizationId,
        creatorId: authSession.userId,
        tags,
      },
      assetIds: standaloneAssetIds,
      // Only pass slices when a kit was involved; the no-kit path stays
      // exactly as before.
      kitSlices: kitIds.length > 0 ? kitSlices : undefined,
      hints: getClientHint(request),
    });

    // Parse per-booking notification recipient IDs from the form.
    // The MultiSelect submits a comma-separated string of team member IDs.
    // Only admin/owner users can set these; the field is hidden for
    // self-service/base users, but we guard server-side as well.
    const notificationRecipientIdsRaw = formData.get(
      "notificationRecipientIds"
    ) as string | null;
    if (notificationRecipientIdsRaw && !isSelfServiceOrBase) {
      const recipientIds = notificationRecipientIdsRaw
        .split(",")
        .filter(Boolean);
      if (recipientIds.length > 0) {
        await updateBookingNotificationRecipients({
          bookingId: booking.id,
          organizationId,
          teamMemberIds: recipientIds,
        });
      }
    }

    sendNotification({
      title: "Booking saved",
      message: "Your booking has been saved successfully",
      icon: { name: "success", variant: "success" },
      senderId: authSession.userId,
    });

    // The booking has assets if EITHER bucket is non-empty. A kit-only
    // creation (no standalone ids, but kit slices) still "has assets" and must
    // land on the overview — not the empty-booking manage-assets flow.
    const bookingHasAssets =
      standaloneAssetIds.length > 0 || kitSlices.length > 0;

    if (intent === "scan") {
      return redirect(`/bookings/${booking.id}/overview/scan-assets`);
    }

    if (bookingHasAssets) {
      /**
       * If the booking was created from a single STANDALONE QUANTITY_TRACKED
       * asset (e.g. via the asset page's "Create new booking" dropdown),
       * append an ?adjustQty=<assetId> search param so the overview route can
       * auto-open the quantity adjust dialog. This avoids the user being
       * silently stuck with quantity=1 when they meant to book more.
       *
       * Gated on `standaloneAssetIds` (not kit members): a kit-only booking
       * has zero standalone ids, so it never triggers this single-asset
       * shortcut and just lands on the overview.
       */
      let redirectUrl = `/bookings/${booking.id}/overview`;
      if (standaloneAssetIds.length === 1) {
        const [singleAssetId] = standaloneAssetIds;
        const addedAsset = await db.asset.findFirst({
          where: { id: singleAssetId, organizationId },
          select: { id: true, type: true },
        });
        if (addedAsset && isQuantityTracked(addedAsset)) {
          redirectUrl += `?adjustQty=${singleAssetId}`;
        }
      }
      return redirect(redirectUrl);
    } else {
      const manageAssetsUrl = `/bookings/${
        booking.id
      }/overview/manage-assets?${new URLSearchParams({
        bookingFrom: (booking.from as Date).toISOString(),
        bookingTo: (booking.to as Date).toISOString(),
        hideUnavailable: "true",
        unhideAssetsBookigIds: booking.id,
      })}`;

      return redirect(manageAssetsUrl);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}

export const links: LinksFunction = () => [{ rel: "stylesheet", href: styles }];

export const handle = {
  name: "bookings.new",
};

export default function NewBooking() {
  const {
    header,
    isSelfServiceOrBase,
    teamMembers,
    assetIds,
    kitId,
    showModal,
  } = useLoaderData<typeof loader>();
  const user = useUserData();
  const dynamicTitle = useAtomValue(dynamicTitleAtom);

  // The loader already takes care of returning only the current user so we just get the first and only element in the array
  const custodianRef = isSelfServiceOrBase
    ? teamMembers.find((tm) => tm.userId === user!.id)?.id
    : undefined;

  const pageTitle = dynamicTitle?.trim().length
    ? dynamicTitle
    : header?.title ?? newBookingHeader.title;

  return (
    <div className="relative">
      <Header
        title={pageTitle}
        subHeading={header?.subHeading}
        hideBreadcrumbs={showModal}
        classNames={showModal ? "[&>div]:border-b-0" : undefined}
      />
      <div className="booking-route-form-wrapper">
        <NewBookingForm
          booking={{
            assetIds,
            custodianRef,
            // Undefined on plain /bookings/new; set by the kit-create route so
            // the kit grouping is preserved in the new booking.
            kitId,
          }}
        />
      </div>
    </div>
  );
}
