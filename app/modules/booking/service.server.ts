import {
  type Booking,
  type Prisma,
  type Organization,
  type Asset,
  BookingStatus,
  AssetStatus,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { getDateTimeFormat } from "~/utils/client-hints";
import { calcTimeDifference } from "~/utils/date-fns";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { Logger } from "~/utils/logger";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { bookingSchedulerEventsEnum, schedulerKeys } from "./constants";
import {
  assetReservedEmailContent,
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  deletedBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import type { ClientHint, SchedulerData } from "./types";
import { createNotes } from "../asset/service.server";
import { getOrganizationAdminsEmails } from "../organization/service.server";

const label: ErrorLabel = "Booking";

/** Includes needed for booking to have all data required for emails */
export const bookingIncludeForEmails = {
  custodianTeamMember: true,
  custodianUser: true,
  organization: {
    include: {
      owner: {
        select: { email: true },
      },
    },
  },
  _count: {
    select: { assets: true },
  },
};

async function cancelScheduler(b?: Booking | null) {
  try {
    if (b?.activeSchedulerReference) {
      await scheduler.cancel(b.activeSchedulerReference);
    }
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to cancel the scheduler for booking",
        additionalData: { booking: b },
        label,
      })
    );
  }
}

export async function scheduleNextBookingJob({
  data,
  when,
}: {
  data: SchedulerData;
  when: Date;
}) {
  try {
    const id = await scheduler.sendAfter(
      schedulerKeys.bookingQueue,
      data,
      {},
      when
    );
    await db.booking.update({
      where: { id: data.id },
      data: { activeSchedulerReference: id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while scheduling the next booking job.",
      additionalData: { ...data, when },
      label,
    });
  }
}

async function updateBookingAssetStates(
  booking: Booking & { assets: Pick<Asset, "id">[] },
  status: AssetStatus
) {
  try {
    return await db.asset.updateMany({
      where: {
        status: { not: status },
        id: { in: booking.assets.map((a) => a.id) },
      },
      data: { status },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the booking asset states.",
      additionalData: { booking, status },
      label,
    });
  }
}

const commonInclude: Prisma.BookingInclude = {
  custodianTeamMember: true,
  custodianUser: true,
};
//client should pass new Date().toIsoString() to action handler for to and from
export async function upsertBooking(
  booking: Partial<
    Pick<
      Booking,
      | "from"
      | "id"
      | "creatorId"
      | "name"
      | "organizationId"
      | "status"
      | "to"
      | "custodianTeamMemberId"
      | "custodianUserId"
    > & { assetIds: Asset["id"][] }
  >,
  hints: ClientHint,
  isSelfService: boolean = false
) {
  try {
    const {
      assetIds,
      creatorId,
      organizationId,
      custodianTeamMemberId,
      custodianUserId,
      id,
      ...rest
    } = booking;
    let data: Prisma.BookingUpdateInput = { ...rest };
    if (assetIds?.length) {
      data.assets = {
        connect: assetIds.map((id) => ({
          id,
        })),
      };
    }
    if (custodianUserId) {
      data.custodianUser = {
        connect: { id: custodianUserId },
      };
      //to change custodian
      // We check if ID is passed,
      // because in the case when we are creating a new booking but passing custodianUserId,
      // there is nothing to disconnect
      // So we only disconnect when id is passed which tells us we are editing an existing booking
      if (id) {
        data.custodianTeamMember = {
          disconnect: true,
        };
      }
    } else if (custodianTeamMemberId) {
      const custodianUser = await db.teamMember
        .findUniqueOrThrow({
          where: {
            id: custodianTeamMemberId,
          },
          select: {
            id: true,
            user: true,
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message: "Cannot find team member",
            additionalData: { custodianTeamMemberId },
            label,
          });
        });

      data.custodianTeamMember = {
        connect: { id: custodianTeamMemberId },
      };

      if (custodianUser.user?.id) {
        data.custodianUser = {
          connect: { id: custodianUser.user.id },
        };
      } else {
        //disconnect any stake userId
        data.custodianUser = {
          disconnect: true,
        };
      }
    }

    /** Editing */
    if (id) {
      let newAssetStatus;
      const isTerminalState = [
        BookingStatus.ARCHIVED,
        BookingStatus.CANCELLED,
        BookingStatus.COMPLETE,
      ].includes(booking.status as any);

      //no need to fetch old booking always, we need only for this case(for now)
      const oldBooking = isTerminalState
        ? await db.booking.findFirst({ where: { id } })
        : null;

      if (isTerminalState) {
        if (
          oldBooking &&
          [BookingStatus.ONGOING, BookingStatus.OVERDUE].includes(
            oldBooking.status as any
          ) // Check if the booking was ongoing or overdue
        ) {
          //booking has ended, make asset available
          newAssetStatus = AssetStatus.AVAILABLE;
        }
        //cancel any active schedulers
        await cancelScheduler(oldBooking);
      }

      //update
      const res = await db.booking
        .update({
          where: { id },
          data,
          include: {
            ...commonInclude,
            assets: true,
            ...bookingIncludeForEmails,
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            message:
              "Something went wrong while updating the booking. Please try again or contact support.",
            additionalData: { id, data },
            label,
          });
        });

      if (
        booking.status === BookingStatus.ONGOING ||
        (res.status === BookingStatus.ONGOING && booking.assetIds?.length)
      ) {
        //booking status is updated to ongoing or assets added to ongoing booking, make asset checked out
        //no need to worry about overdue as the previous state is always ongoing
        newAssetStatus = AssetStatus.CHECKED_OUT;
      }

      const promises = [];
      if (newAssetStatus) {
        promises.push(updateBookingAssetStates(res, newAssetStatus));
      }
      if (res.from && booking.status === BookingStatus.RESERVED) {
        promises.push(cancelScheduler(res));
        const when = new Date(res.from);
        when.setHours(when.getHours() - 1); //1hour before send checkout reminder
        promises.push(
          scheduleNextBookingJob({
            data: {
              id: res.id,
              hints,
              eventType: bookingSchedulerEventsEnum.checkoutReminder,
            },
            when,
          })
        );
      }
      /** Handle email notification when booking status changes */
      if (data.status) {
        const email = res.custodianUser?.email;
        if (email) {
          if (
            data.status === BookingStatus.RESERVED ||
            data.status === BookingStatus.COMPLETE ||
            data.status === BookingStatus.CANCELLED
          ) {
            const custodian =
              `${res.custodianUser?.firstName} ${res.custodianUser?.lastName}` ||
              (res.custodianTeamMember?.name as string);
            let subject = `Booking reserved (${res.name}) - shelf.nu`;
            let text = assetReservedEmailContent({
              bookingName: res.name,
              assetsCount: res.assets.length,
              custodian: custodian,
              from: res.from!,
              to: res.to!,
              hints,
              bookingId: res.id,
            });
            let html = bookingUpdatesTemplateString({
              booking: res,
              heading: `Booking reservation for ${custodian}`,
              assetCount: res.assets.length,
              hints,
            });

            /** Here we need to check if the custodian is different than the admin and send email to the admin in case they are different */
            if (isSelfService) {
              const adminsEmails = await getOrganizationAdminsEmails({
                organizationId: res.organizationId,
              });

              const adminSubject = `Booking reservation request (${res.name}) by ${custodian} - shelf.nu`;

              /** Pushing admins emails to promises */
              promises.push(
                sendEmail({
                  to: adminsEmails.join(","),
                  subject: adminSubject,
                  text,
                  /** We need to invoke this function separately for the admin email as the footer of emails is different */
                  html: bookingUpdatesTemplateString({
                    booking: res,
                    heading: `Booking reservation request for ${custodian}`,
                    assetCount: res.assets.length,
                    hints,
                    isAdminEmail: true,
                  }),
                })
              );
            }

            if (data.status === BookingStatus.COMPLETE) {
              subject = `Booking completed (${res.name}) - shelf.nu`;
              text = completedBookingEmailContent({
                bookingName: res.name,
                assetsCount: res._count.assets,
                custodian: custodian,
                from: booking.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
                to: booking.to as Date,
                bookingId: res.id,
                hints: hints,
              });
              html = bookingUpdatesTemplateString({
                booking: res,
                heading: `Your booking has been completed: "${res.name}".`,
                assetCount: res._count.assets,
                hints,
              });
            }

            if (data.status === BookingStatus.CANCELLED) {
              subject = `Booking canceled (${res.name}) - shelf.nu`;
              text = cancelledBookingEmailContent({
                bookingName: res.name,
                assetsCount: res._count.assets,
                custodian:
                  `${res.custodianUser?.firstName} ${res.custodianUser?.lastName}` ||
                  (res.custodianTeamMember?.name as string),
                from: booking.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
                to: booking.to as Date,
                bookingId: res.id,
                hints: hints,
              });
              html = bookingUpdatesTemplateString({
                booking: res,
                heading: `Your booking has been cancelled: "${res.name}".`,
                assetCount: res._count.assets,
                hints,
              });
            }

            promises.push(
              sendEmail({
                to: email,
                subject,
                text,
                html,
              })
            );
          } else if (data.status === BookingStatus.ONGOING && res.to) {
            const { hours } = calcTimeDifference(res.to, new Date());
            if (hours < 1) {
              //booking checkout time has already passed, so scheduler has skipped the notification, so we send here
              promises.push(sendCheckinReminder(res, res.assets.length, hints));
            }
          }
        }
      }

      await Promise.all(promises);
      return res;
    }

    //only while creating we can connect creator and org, updating is not allowed
    if (creatorId) {
      data.creator = {
        connect: { id: creatorId },
      };
    }
    if (organizationId) {
      data.organization = {
        connect: { id: organizationId },
      };
    }
    const res = await db.booking.create({
      data: data as Prisma.BookingCreateInput,
      include: { ...commonInclude, organization: true },
    });
    if (res.from && booking.status === BookingStatus.RESERVED) {
      await cancelScheduler(res);
      const when = new Date(res.from);
      when.setHours(when.getHours() - 1); //1hour before send checkout reminder
      await scheduleNextBookingJob({
        data: {
          id: res.id,
          hints,
          eventType: bookingSchedulerEventsEnum.checkoutReminder,
        },
        when,
      });
    }
    return res;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while trying to create or update the booking. Please try again or contact support.",
      additionalData: { booking, hints, isSelfService },
      label,
    });
  }
}

export async function getBookings(params: {
  organizationId: Organization["id"];
  /** Page number. Starts at 1 */
  page: number;
  /** Assets to be loaded per page */
  perPage?: number;
  search?: string | null;
  statuses?: Booking["status"][] | null;
  assetIds?: Asset["id"][] | null;
  custodianUserId?: Booking["custodianUserId"] | null;
  custodianTeamMemberId?: Booking["custodianTeamMemberId"] | null;
  excludeBookingIds?: Booking["id"][] | null;
  bookingFrom?: Booking["from"] | null;
  bookingTo?: Booking["to"] | null;
  userId: Booking["creatorId"];
  extraInclude?: Prisma.BookingInclude;
}) {
  const {
    organizationId,
    page = 1,
    perPage = 8,
    search,
    statuses,
    custodianUserId,
    custodianTeamMemberId,
    assetIds,
    bookingTo,
    excludeBookingIds,
    bookingFrom,
    userId,
    extraInclude,
  } = params;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 25 per page

    /** Default value of where. Takes the assetss belonging to current org */
    let where: Prisma.BookingWhereInput = { organizationId };

    /** The idea is that only the creator of a draft booking can see it
     * This condition will fetch all bookings that are not in 'DRAFT' status, and also the bookings that are in 'DRAFT' status but only if their creatorId is the same as the userId
     */
    where.AND = [
      {
        OR: [
          {
            status: {
              not: "DRAFT",
            },
          },
          {
            AND: [
              {
                status: "DRAFT",
              },
              {
                creatorId: userId,
              },
            ],
          },
        ],
      },
    ];

    /** If the search string exists, add it to the where object */
    if (search?.trim()?.length) {
      where.name = {
        contains: search.trim(),
        mode: "insensitive",
      };
    }
    if (custodianTeamMemberId) {
      where.custodianTeamMemberId = custodianTeamMemberId;
    }
    if (custodianUserId) {
      where.custodianUserId = custodianUserId;
    }
    if (statuses?.length) {
      where.status = {
        in: statuses,
      };
    } else {
      where.status = {
        notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED], // By default we dont show archived & cancelled bookings
      };
    }

    if (assetIds?.length) {
      where.assets = {
        some: {
          id: {
            in: assetIds,
          },
        },
      };
    }

    if (excludeBookingIds?.length) {
      where.id = { notIn: excludeBookingIds };
    }
    if (bookingFrom && bookingTo) {
      where.OR = [
        {
          from: { lte: bookingTo },
          to: { gte: bookingFrom },
        },
        {
          from: { gte: bookingFrom },
          to: { lte: bookingTo },
        },
      ];
    }

    const [bookings, bookingCount] = await Promise.all([
      db.booking.findMany({
        skip,
        take,
        where,
        include: {
          ...commonInclude,
          assets: {
            select: {
              id: true,
              custody: true,
              availableToBook: true,
            },
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          ...(extraInclude || undefined),
        },
        orderBy: { from: "asc" },
      }),
      db.booking.count({ where }),
    ]);

    return { bookings, bookingCount };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}

export async function removeAssets({
  booking,
  firstName,
  lastName,
  userId,
}: {
  booking: Pick<Booking, "id"> & {
    assetIds: Asset["id"][];
  };
  firstName: string;
  lastName: string;
  userId: string;
}) {
  try {
    const { assetIds, id } = booking;
    const b = await db.booking.update({
      // First, disconnect the assets from the booking
      where: { id },
      data: {
        assets: {
          disconnect: assetIds.map((id) => ({ id })),
        },
      },
    });
    /** When removing an asset from a booking we need to make sure to set their status back to available
     * This is needed because the user is allowed to remove an asset from a booking that is ongoing, which means the asset status will be CHECKED_OUT
     * So we need to set it back to AVAILABLE
     * We only do that if the booking we removed it from is ongoing or overdue.
     * Reason is that the user can add an asset to a draft booking and remove it and that will reset its status back to available, which shouldnt happen
     * https://github.com/Shelf-nu/shelf.nu/issues/703#issuecomment-1944315975
     *
     * Because prisma doesnt support transactional execution of nested queries, we need to do them in 2 steps, because if the disconnect runs first,
     * the updateMany will not find the assets in the booking anymore and wont update them
     */
    if (
      b.status === BookingStatus.ONGOING ||
      b.status === BookingStatus.OVERDUE
    ) {
      await db.asset.updateMany({
        where: { id: { in: assetIds } },
        data: { status: AssetStatus.AVAILABLE },
      });
    }

    await createNotes({
      content: `**${firstName?.trim()} ${lastName?.trim()}** removed asset from booking **[${
        b.name
      }](/bookings/${b.id})**.`,
      type: "UPDATE",
      userId,
      assetIds,
    });

    return b;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while removing assets from the booking. Please try again or contact support.",
      additionalData: { booking, userId },
      label,
    });
  }
}

export async function deleteBooking(
  booking: Pick<Booking, "id">,
  hints: ClientHint
) {
  try {
    const { id } = booking;
    const activeBooking = await db.booking.findFirst({
      where: {
        id,
        status: { in: [BookingStatus.OVERDUE, BookingStatus.ONGOING] },
      },
      include: {
        assets: {
          select: {
            id: true,
          },
        },
      },
    });
    const b = await db.booking.delete({
      where: { id },
      include: {
        ...commonInclude,
        ...bookingIncludeForEmails,
        assets: {
          select: {
            id: true,
          },
        },
      },
    });

    const email = b.custodianUser?.email;
    if (email) {
      const subject = `Booking deleted (${b.name}) - shelf.nu`;
      const text = deletedBookingEmailContent({
        bookingName: b.name,
        assetsCount: b._count.assets,
        custodian:
          `${b.custodianUser?.firstName} ${b.custodianUser?.lastName}` ||
          (b.custodianTeamMember?.name as string),
        from: b.from as Date, // We can safely cast here as we know the booking is overdue so it myust have a from and to date
        to: b.to as Date,
        bookingId: b.id,
        hints: hints,
      });
      const html = bookingUpdatesTemplateString({
        booking: b,
        heading: `Your booking has been deleted: "${b.name}".`,
        assetCount: b._count.assets,
        hints,
        hideViewButton: true,
      });

      await sendEmail({
        to: email,
        subject,
        text,
        html,
      });
    }

    // FIXME: if sendEmail fails updateBookinAssetStates will not be called
    /** Because assets in an active booking have a special status, we need to update them if we delete a booking */
    if (activeBooking) {
      await updateBookingAssetStates(activeBooking, AssetStatus.AVAILABLE);
    }
    await cancelScheduler(b);

    return b;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while deleting the booking. Please try again or contact support.",
      additionalData: { booking, hints },
      label,
    });
  }
}

export async function getBooking(
  booking: Pick<Booking, "id" | "organizationId">
) {
  try {
    const { id, organizationId } = booking;

    /**
     * On the booking page, we need some data related to the assets added, so we know what actions are possible
     *
     * For reserving a booking, we need to make sure that the assets in the booking dont have any other bookings that overlap with the current booking
     * Moreover we just query certain statuses as they are the only ones that matter for an asset being considered unavailable
     */
    return await db.booking.findFirstOrThrow({
      where: { id, organizationId },
      include: {
        ...commonInclude,
        assets: {
          select: { id: true, availableToBook: true, status: true },
        },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      title: "Booking not found",
      message:
        "The booking you are trying to access does not exist or you do not have permission to access it.",
      additionalData: { booking },
      label,
    });
  }
}

export async function getBookingsForCalendar(params: {
  request: Request;
  organizationId: Organization["id"];
  userId: string;
  isSelfService: boolean;
}) {
  const { request, organizationId, userId, isSelfService = false } = params;
  const searchParams = getCurrentSearchParams(request);

  // @TODO we have to see how to handle this if there are no search params
  const start = searchParams.get("start") as string;
  const end = searchParams.get("end") as string;

  try {
    const { bookings } = await getBookings({
      organizationId,
      page: 1,
      perPage: 1000,
      userId,
      bookingFrom: new Date(start),
      bookingTo: new Date(end),
      ...(isSelfService && {
        // If the user is self service, we only show bookings that belong to that user)
        custodianUserId: userId,
      }),
      extraInclude: {
        custodianTeamMember: true,
        custodianUser: true,
      },
    });

    const events = bookings
      .filter((booking) => booking.from && booking.to)
      .map((booking) => {
        const custodianName = booking?.custodianUser
          ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
          : booking.custodianTeamMember?.name;

        const start = getDateTimeFormat(request, {
          dateStyle: "short",
          timeStyle: "short",
        }).format(booking.from as Date);

        return {
          title: `${start} | ${booking.name} | ${custodianName}`,
          start: (booking.from as Date).toISOString(),
          end: (booking.to as Date).toISOString(),
          extendedProps: {
            status: booking.status,
            id: booking.id,
          },
        };
      });

    return events;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while fetching the bookings for the calendar. Please try again or contact support.",
      additionalData: { ...params },
      label,
    });
  }
}
