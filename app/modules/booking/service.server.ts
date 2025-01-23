import { BookingStatus, AssetStatus, KitStatus } from "@prisma/client";
import type {
  Booking,
  Prisma,
  Organization,
  Asset,
  Kit,
  User,
  UserOrganization,
} from "@prisma/client";
import { db } from "~/database/db.server";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { sendEmail } from "~/emails/mail.server";
import { getStatusClasses, isOneDayEvent } from "~/utils/calendar";
import { getDateTimeFormat } from "~/utils/client-hints";
import { calcTimeDifference } from "~/utils/date-fns";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, isNotFoundError, ShelfError } from "~/utils/error";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import { Logger } from "~/utils/logger";
import { QueueNames, scheduler } from "~/utils/scheduler.server";
import type { MergeInclude } from "~/utils/utils";
import { bookingSchedulerEventsEnum } from "./constants";
import {
  assetReservedEmailContent,
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  deletedBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import type { BookingUpdateIntent, ClientHint, SchedulerData } from "./types";
// eslint-disable-next-line import/no-cycle
import { getBookingWhereInput } from "./utils.server";
import { createNotes } from "../note/service.server";
import { getOrganizationAdminsEmails } from "../organization/service.server";
import { getUserByID } from "../user/service.server";

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
      QueueNames.bookingQueue,
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

async function updateBookingKitStates({
  kitIds,
  status,
}: {
  kitIds: string[];
  status: KitStatus;
}) {
  try {
    return await db.kit.updateMany({
      where: { id: { in: kitIds } },
      data: { status },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating the booking kit states.",
      additionalData: { kitIds, status },
      label,
    });
  }
}

const BOOKING_COMMON_INCLUDE = {
  custodianTeamMember: true,
  custodianUser: true,
} as Prisma.BookingInclude;
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
      | "description"
    > & {
      assetIds: Asset["id"][];
      isExpired: boolean;
    }
  >,
  hints: ClientHint,
  isBaseOrSelfService: boolean = false
) {
  try {
    const {
      assetIds,
      creatorId,
      organizationId,
      custodianTeamMemberId,
      custodianUserId,
      id,
      description,
      isExpired,
      ...rest
    } = booking;
    let data: Prisma.BookingUpdateInput = { ...rest };

    const assetsWithKits = id
      ? await db.asset.findMany({
          where: { bookings: { some: { id } } },
          select: { id: true, kitId: true },
        })
      : null;

    const kitIds = getKitIdsByAssets(assetsWithKits ?? []);
    const hasKits = kitIds.length > 0;

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
      } else if (id) {
        const b = await db.booking.findFirst({
          where: { id },
          select: { custodianUserId: true },
        });

        if (b?.custodianUserId) {
          data.custodianUser = {
            disconnect: true,
          };
        }
      }
    }

    if (description) {
      data.description = description;
    }

    /** Editing */
    if (id) {
      let newAssetStatus;
      let newKitStatus;
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
          // booking has ended, make asset available
          newAssetStatus = AssetStatus.AVAILABLE;

          // if booking as some kits, make kits available
          if (hasKits) {
            newKitStatus = KitStatus.AVAILABLE;
          }
        }
        //cancel any active schedulers
        await cancelScheduler(oldBooking);
      }

      //update
      const res = await db.booking
        .update({
          where: { id, organizationId },
          data,
          include: {
            ...BOOKING_COMMON_INCLUDE,
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
        // For both regular checkouts (ONGOING) and expired checkouts (OVERDUE)
        ((booking.status === BookingStatus.ONGOING ||
          booking.status === BookingStatus.OVERDUE) &&
          isExpired) ||
        booking.status === BookingStatus.ONGOING ||
        (res.status === BookingStatus.ONGOING && booking.assetIds?.length)
      ) {
        newAssetStatus = AssetStatus.CHECKED_OUT;
        if (hasKits) {
          newKitStatus = AssetStatus.CHECKED_OUT;
        }
      }

      const promises = [];
      if (newAssetStatus) {
        promises.push(updateBookingAssetStates(res, newAssetStatus));
      }

      if (newKitStatus) {
        promises.push(
          updateBookingKitStates({
            kitIds,
            status: newKitStatus,
          })
        );
      }

      if (
        res.from &&
        booking.status === BookingStatus.RESERVED &&
        !booking.isExpired //Only schedule if the booking is not already
      ) {
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
            let subject = `✅ Booking reserved (${res.name}) - shelf.nu`;
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
            if (isBaseOrSelfService) {
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
      include: { ...BOOKING_COMMON_INCLUDE, organization: true },
    });
    if (res.from && booking.status === BookingStatus.RESERVED && !isExpired) {
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
      additionalData: { booking, hints, isBaseOrSelfService },
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
  /** Accepts an array of team member IDs instead of a single ID so it can be used for filtering of bookings on index */
  custodianTeamMemberIds?: string[] | null;
  excludeBookingIds?: Booking["id"][] | null;
  bookingFrom?: Booking["from"] | null;
  bookingTo?: Booking["to"] | null;
  userId: Booking["creatorId"];
  extraInclude?: Prisma.BookingInclude;
  /** Controls whether entries should be paginated or not */
  takeAll?: boolean;
}) {
  const {
    organizationId,
    page = 1,
    perPage = 8,
    search,
    statuses,
    custodianUserId,
    custodianTeamMemberIds,
    assetIds,
    bookingTo,
    excludeBookingIds,
    bookingFrom,
    userId,
    extraInclude,
    takeAll = false,
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

    /** Handle combination of custodianTeamMemberIds and custodianUserId */
    if (
      custodianTeamMemberIds &&
      custodianTeamMemberIds?.length &&
      custodianUserId
    ) {
      where.OR = [
        {
          custodianTeamMemberId: {
            in: custodianTeamMemberIds,
          },
        },
        {
          custodianUserId,
        },
      ];
    } else {
      /** Handle custodianTeamMemberIds if present */
      if (custodianTeamMemberIds?.length) {
        where.custodianTeamMemberId = {
          in: custodianTeamMemberIds,
        };
      }
      /** Handle custodianUserId if present */
      if (custodianUserId) {
        where.custodianUserId = custodianUserId;
      }
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
        ...(!takeAll && {
          skip,
          take,
        }),
        where,
        include: {
          ...BOOKING_COMMON_INCLUDE,
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
  kitIds = [],
  organizationId,
}: {
  booking: Pick<Booking, "id"> & {
    assetIds: Asset["id"][];
  };
  firstName: string;
  lastName: string;
  userId: string;
  kitIds?: Kit["id"][];
  organizationId: Booking["organizationId"];
}) {
  try {
    const { assetIds, id } = booking;
    const b = await db.booking.update({
      // First, disconnect the assets from the booking
      where: { id, organizationId },
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
     *
     * If there was some kit removed from the booking, then we have to update the status of that kit to available
     */
    if (
      b.status === BookingStatus.ONGOING ||
      b.status === BookingStatus.OVERDUE
    ) {
      await db.asset.updateMany({
        where: { id: { in: assetIds }, organizationId },
        data: { status: AssetStatus.AVAILABLE },
      });

      if (kitIds.length > 0) {
        await db.kit.updateMany({
          where: { id: { in: kitIds }, organizationId },
          data: { status: KitStatus.AVAILABLE },
        });
      }
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
  booking: Pick<Booking, "id" | "organizationId">,
  hints: ClientHint
) {
  try {
    const { id, organizationId } = booking;
    const activeBooking = await db.booking.findFirst({
      where: {
        id,
        status: { in: [BookingStatus.OVERDUE, BookingStatus.ONGOING] },
        organizationId,
      },
      include: {
        assets: {
          select: {
            id: true,
            kitId: true,
          },
        },
      },
    });

    const assetWithKits = activeBooking?.assets.filter((a) => !!a.kitId) ?? [];
    const uniqueKitIds = new Set(
      assetWithKits.map((a) => a.kitId) as unknown as string
    );
    const hasKits = uniqueKitIds.size > 0;

    const b = await db.booking.delete({
      where: { id, organizationId },
      include: {
        ...BOOKING_COMMON_INCLUDE,
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
      const subject = `🗑️ Booking deleted (${b.name}) - shelf.nu`;
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

      sendEmail({
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

      // If booking has some kits, then make them available too
      if (hasKits) {
        await updateBookingKitStates({
          kitIds: [...uniqueKitIds],
          status: KitStatus.AVAILABLE,
        });
      }
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

const BOOKING_WITH_ASSETS_INCLUDE = {
  ...BOOKING_COMMON_INCLUDE,
  assets: {
    select: {
      id: true,
      availableToBook: true,
      status: true,
      kitId: true,
    },
  },
} satisfies Prisma.BookingInclude;

type BookingWithExtraInclude<T extends Prisma.BookingInclude | undefined> =
  T extends Prisma.BookingInclude
    ? Prisma.BookingGetPayload<{
        include: MergeInclude<typeof BOOKING_WITH_ASSETS_INCLUDE, T>;
      }>
    : Prisma.BookingGetPayload<{ include: typeof BOOKING_WITH_ASSETS_INCLUDE }>;

export async function getBooking<T extends Prisma.BookingInclude | undefined>(
  booking: Pick<Booking, "id" | "organizationId"> & {
    userOrganizations?: Pick<UserOrganization, "organizationId">[];
    request?: Request;
    extraInclude?: T;
  }
) {
  try {
    const { id, organizationId, userOrganizations, request, extraInclude } =
      booking;

    /**
     * On the booking page, we need some data related to the assets added, so we know what actions are possible
     *
     * For reserving a booking, we need to make sure that the assets in the booking dont have any other bookings that overlap with the current booking
     * Moreover we just query certain statuses as they are the only ones that matter for an asset being considered unavailable
     */
    const mergedInclude = {
      ...BOOKING_WITH_ASSETS_INCLUDE,
      ...extraInclude,
    } as MergeInclude<typeof BOOKING_WITH_ASSETS_INCLUDE, T>;

    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    const bookingFound = (await db.booking.findFirstOrThrow({
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: mergedInclude,
    })) as BookingWithExtraInclude<T>;

    /* User is accessing the asset in the wrong organization. */
    if (
      userOrganizations?.length &&
      bookingFound.organizationId !== organizationId &&
      otherOrganizationIds?.includes(bookingFound.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Booking not found",
        message: "",
        additionalData: {
          model: "booking",
          organization: userOrganizations?.find(
            (org) => org.organizationId === bookingFound.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
      });
    }

    return bookingFound;
  } catch (cause) {
    const is404 = isNotFoundError(cause);
    throw new ShelfError({
      cause,
      title: "Booking not found",
      message:
        "The booking you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        ...booking,
        ...(isLikeShelfError(cause) ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: !is404,
    });
  }
}

export async function getBookingsForCalendar(params: {
  request: Request;
  organizationId: Organization["id"];
  userId: string;
  isSelfServiceOrBase: boolean;
}) {
  const {
    request,
    organizationId,
    userId,
    isSelfServiceOrBase = false,
  } = params;
  const searchParams = getCurrentSearchParams(request);

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
      ...(isSelfServiceOrBase && {
        // If the user is self service, we only show bookings that belong to that user)
        custodianUserId: userId,
      }),
      extraInclude: {
        custodianTeamMember: true,
        custodianUser: true,
      },
      takeAll: true,
    });

    const events = bookings
      .filter((booking) => booking.from && booking.to)
      .map((booking) => {
        const custodianName = booking?.custodianUser
          ? `${booking.custodianUser.firstName} ${booking.custodianUser.lastName}`
          : booking.custodianTeamMember?.name;

        return {
          title: `${booking.name} | ${custodianName}`,
          start: (booking.from as Date).toISOString(),
          end: (booking.to as Date).toISOString(),
          url: `/bookings/${booking.id}`,
          classNames: [
            `bookingId-${booking.id}`,
            ...getStatusClasses(
              booking.status,
              isOneDayEvent(booking.from as Date, booking.to as Date)
            ),
          ],
          extendedProps: {
            status: booking.status,
            id: booking.id,
            name: booking.name,
            description: booking.description,
            start: (booking.from as Date).toISOString(),
            end: (booking.to as Date).toISOString(),
            custodian: {
              name: custodianName,
              image: booking.custodianUser
                ? booking.custodianUser.profilePicture
                : undefined,
            },
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
export async function createNotesForBookingUpdate(
  intent: BookingUpdateIntent,
  booking: Booking & { assets: Pick<Asset, "id">[] },
  user: { firstName: string; lastName: string; id: string }
) {
  switch (intent) {
    case "checkOut":
      await createNotes({
        content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** checked out asset with **[${
          booking.name
        }](/bookings/${booking.id})**.`,
        type: "UPDATE",
        userId: user.id,
        assetIds: booking.assets.map((a) => a.id),
      });
      break;
    case "checkIn":
      /** Create check-in notes for all assets */
      await createNotes({
        content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** checked in asset with **[${
          booking.name
        }](/bookings/${booking.id})**.`,
        type: "UPDATE",
        userId: user.id,
        assetIds: booking.assets.map((a) => a.id),
      });
      break;
    default:
      break;
  }
}

export function sendBookingUpdateNotification(
  intent: BookingUpdateIntent,
  senderId: string
) {
  /** The cases that are not covered here is because the action already reutns within the switch and takes care of the notification */
  switch (intent) {
    case "save":
      sendNotification({
        title: "Booking saved",
        message: "Your booking has been saved successfully",
        icon: { name: "success", variant: "success" },
        senderId,
      });
      break;
    case "reserve":
      /** Send reserved notification */
      sendNotification({
        title: "Booking reserved",
        message: "Your booking has been reserved successfully",
        icon: { name: "success", variant: "success" },
        senderId,
      });

      break;

    case "checkOut":
      sendNotification({
        title: "Booking checked-out",
        message: "Your booking has been checked-out successfully",
        icon: { name: "success", variant: "success" },
        senderId,
      });

      break;
    case "checkIn":
      sendNotification({
        title: "Booking checked-in",
        message: "Your booking has been checked-in successfully",
        icon: { name: "success", variant: "success" },
        senderId,
      });
      break;

    default:
      break;
  }
}

export function getKitIdsByAssets(assets: Pick<Asset, "id" | "kitId">[]) {
  const assetsWithKit = assets.filter((a) => !!a.kitId) as Array<{
    id: string;
    kitId: string;
  }>;

  const allKitIds = assetsWithKit.map((a) => a.kitId);
  const uniqueKitIds = new Set(allKitIds);

  return [...uniqueKitIds];
}

export async function getBookingFlags(
  booking: Pick<Booking, "id" | "from" | "to"> & {
    assetIds: Asset["id"][];
  }
) {
  const assets = await db.asset.findMany({
    where: { id: { in: booking.assetIds } },
    include: {
      category: true,
      custody: true,
      kit: true,
      bookings: {
        where: {
          ...(booking.from && booking.to
            ? {
                status: { in: ["RESERVED", "ONGOING", "OVERDUE"] },
                OR: [
                  {
                    from: { lte: booking.to },
                    to: { gte: booking.from },
                  },
                  {
                    from: { gte: booking.from },
                    to: { lte: booking.to },
                  },
                ],
              }
            : {}),
        },
      },
    },
  });

  const hasAssets = assets.length > 0;

  const hasUnavailableAssets = assets.some((asset) => !asset.availableToBook);

  const hasCheckedOutAssets = assets.some(
    (asset) => asset.status === AssetStatus.CHECKED_OUT
  );

  const hasAlreadyBookedAssets = assets.some(
    (asset) => asset.bookings && asset.bookings.length > 0
  );

  const hasAssetsInCustody = assets.some(
    (asset) => asset.status === AssetStatus.IN_CUSTODY
  );

  const hasKits = assets.some((asset) => !!asset.kitId);

  return {
    hasAssets,
    hasUnavailableAssets,
    hasCheckedOutAssets,
    hasAlreadyBookedAssets,
    hasAssetsInCustody,
    hasKits,
  };
}

export async function bulkDeleteBookings({
  bookingIds,
  organizationId,
  userId,
  hints,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  hints: ClientHint;
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          custodianTeamMember: true,
          custodianUser: true,
          organization: { include: { owner: { select: { email: true } } } },
          _count: { select: { assets: true } },
          assets: { select: { id: true, kitId: true } },
        },
      }),
      getUserByID(userId),
    ]);

    /** We have to send mails to custodianUsers */
    const bookingsToSendEmail = bookings.filter(
      (booking) => !!booking.custodianUser?.email
    );

    /** If some booking was OVERDUE or ONGOING, we have to make their assets and kits available */
    const overdueOrOngoingBookings = bookings.filter(
      (booking) => booking.status === "OVERDUE" || booking.status === "ONGOING"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = overdueOrOngoingBookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Deleting all selected bookings */
      await tx.booking.deleteMany({
        where: { id: { in: bookings.map((booking) => booking.id) } },
      });

      /** Making assets and kits available */
      if (overdueOrOngoingBookings.length > 0) {
        const allAssets = overdueOrOngoingBookings.flatMap(
          (booking) => booking.assets
        );

        const allKitIds = allAssets
          .filter((asset) => !!asset.kitId)
          .map((asset) => asset.kitId as string);

        const uniqueKitIds = new Set(allKitIds);

        await tx.asset.updateMany({
          where: { id: { in: allAssets.map((asset) => asset.id) } },
          data: { status: AssetStatus.AVAILABLE },
        });

        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] } },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const notesData = bookings
        .map((booking) =>
          booking.assets.map((asset) => ({
            userId,
            assetId: asset.id,
            content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** deleted booking **${
              booking.name
            }**.`,
            type: "UPDATE" as const,
          }))
        )
        .flat() satisfies Prisma.NoteCreateManyInput[];

      await tx.note.createMany({ data: notesData });
    });

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    const emailConfigs = bookingsToSendEmail.map((b) => ({
      to: b.custodianUser?.email ?? "",
      subject: `🗑️ Booking deleted (${b.name}) - shelf.nu`,
      text: deletedBookingEmailContent({
        bookingName: b.name,
        assetsCount: b.assets.length,
        custodian:
          `${b.custodianUser?.firstName} ${b.custodianUser?.lastName}` ||
          (b.custodianTeamMember?.name as string),
        from: b.from as Date,
        to: b.to as Date,
        bookingId: b.id,
        hints,
      }),
      html: bookingUpdatesTemplateString({
        booking: b,
        heading: `Your booking as been deleted: "${b.name}"`,
        assetCount: b.assets.length,
        hints,
        hideViewButton: true,
      }),
    }));

    // Send emails with rate limiting
    return emailConfigs.map(sendEmail);
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk deleting bookings.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { bookingIds, organizationId },
      label,
    });
  }
}

export async function bulkArchiveBookings({
  bookingIds,
  organizationId,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const bookings = await db.booking.findMany({ where });

    const someBookingNotComplete = bookings.some(
      (b) => b.status !== "COMPLETE"
    );

    /** Bookings must be complete to add them in archive */
    if (someBookingNotComplete) {
      throw new ShelfError({
        cause: null,
        message:
          "Some bookings are not complete. Please make sure you are selecting completed bookings to archive them.",
        label,
      });
    }

    await db.$transaction(async (tx) => {
      /** Updating status of bookings to ARCHIVED  */
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) } },
        data: { status: BookingStatus.ARCHIVED },
      });
    });

    /** Cancel any active schedulers */
    await Promise.all(bookings.map((b) => cancelScheduler(b)));
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk archive booking.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { bookingIds, organizationId },
      label,
    });
  }
}

export async function bulkCancelBookings({
  bookingIds,
  organizationId,
  userId,
  hints,
  currentSearchParams,
}: {
  bookingIds: Booking["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  hints: ClientHint;
  currentSearchParams?: string | null;
}) {
  try {
    /** If all are selected in the list, then we have to consider filter */
    const where: Prisma.BookingWhereInput = bookingIds.includes(
      ALL_SELECTED_KEY
    )
      ? getBookingWhereInput({ currentSearchParams, organizationId })
      : { id: { in: bookingIds }, organizationId };

    const [bookings, user] = await Promise.all([
      db.booking.findMany({
        where,
        include: {
          custodianTeamMember: true,
          custodianUser: true,
          organization: { include: { owner: { select: { email: true } } } },
          _count: { select: { assets: true } },
          assets: { select: { id: true, kitId: true } },
        },
      }),
      getUserByID(userId),
    ]);

    /** Bookings with any of these statuses cannot be cancelled */
    const unavailableBookingStatus: BookingStatus[] = [
      BookingStatus.ARCHIVED,
      BookingStatus.CANCELLED,
      BookingStatus.COMPLETE,
      BookingStatus.DRAFT,
    ];

    const someUnavailableToCancelBookings = bookings.some((b) =>
      unavailableBookingStatus.includes(b.status)
    );

    if (someUnavailableToCancelBookings) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable to cancel booking selected. Please make sure you are selecting the booking which are allowed to cancel.",
        label,
      });
    }

    /** We have to send mails to custodianUsers */
    const bookingsToSendEmail = bookings.filter(
      (booking) => !!booking.custodianUser?.email
    );

    /** We have to make all the assets and kits available if the booking as ongoing or overdue */
    const ongoingOrOverdueBookings = bookings.filter(
      (b) => b.status === "ONGOING" || b.status === "OVERDUE"
    );

    /** We have to cancel scheduler for the bookings */
    const bookingsWithSchedulerReference = ongoingOrOverdueBookings.filter(
      (booking) => !!booking.activeSchedulerReference
    );

    await db.$transaction(async (tx) => {
      /** Updating status of bookings to CANCELLED */
      await tx.booking.updateMany({
        where: { id: { in: bookings.map((b) => b.id) } },
        data: { status: BookingStatus.CANCELLED },
      });

      /** Updating status of assets and kits  */
      if (ongoingOrOverdueBookings.length > 0) {
        const allAssets = ongoingOrOverdueBookings.flatMap((b) => b.assets);
        const allKitIds = allAssets
          .filter((a) => !!a.kitId)
          .map((a) => a.kitId as string);

        const uniqueKitIds = new Set(allKitIds);

        /** Making assets available */
        await tx.asset.updateMany({
          where: { id: { in: allAssets.map((a) => a.id) } },
          data: { status: AssetStatus.AVAILABLE },
        });

        /** Making kits available */
        await tx.kit.updateMany({
          where: { id: { in: [...uniqueKitIds] } },
          data: { status: KitStatus.AVAILABLE },
        });
      }

      /** Making notes for all the assets */
      const notesData = bookings
        .map((b) =>
          b.assets.map((asset) => ({
            assetId: asset.id,
            content: `**${user?.firstName?.trim()} ${user?.lastName?.trim()}** cancelled booking **[${
              b.name
            }](/bookings/${b.id})**.`,
            userId,
            type: "UPDATE" as const,
          }))
        )
        .flat() satisfies Prisma.NoteCreateManyInput[];

      await tx.note.createMany({ data: notesData });
    });

    /** Cancelling scheduler */
    await Promise.all(
      bookingsWithSchedulerReference.map((booking) => cancelScheduler(booking))
    );

    /** Sending cancellation emails */
    await Promise.all(
      bookingsToSendEmail.map((b) => {
        const subject = `❌ Booking cancelled (${b.name}) - shelf.nu`;
        const text = cancelledBookingEmailContent({
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
          heading: `Your booking has been cancelled: "${b.name}".`,
          assetCount: b._count.assets,
          hints,
        });

        return sendEmail({
          to: b.custodianUser?.email ?? "",
          subject,
          text,
          html,
        });
      })
    );
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk cancelling bookings.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { bookingIds, organizationId, userId },
      label,
    });
  }
}

export async function addScannedAssetsToBooking({
  assetIds,
  bookingId,
  organizationId,
}: {
  assetIds: Asset["id"][];
  bookingId: Booking["id"];
  organizationId: Booking["organizationId"];
}) {
  try {
    const booking = await db.booking.findFirstOrThrow({
      where: { id: bookingId, organizationId },
    });

    /** We just add all the assets to the booking, and let the user manage the list on the booking page.
     * If there are already checked out or in custody assets, the user wont be able to check out
     */

    /** Adding assets into booking */
    return await db.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: booking.id },
        data: {
          assets: {
            connect: assetIds.map((id) => ({ id })),
          },
        },
      });
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while adding scanned assets to booking.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { assetIds, bookingId, organizationId },
      label,
    });
  }
}

export async function getExistingBookingDetails(bookingId: string) {
  try {
    const booking = await db.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        assets: { select: { id: true, title: true } },
      },
    });

    if (!["DRAFT", "RESERVED"].includes(booking.status!)) {
      throw new ShelfError({
        cause: null,
        message: "Booking is not in Draft or Reserved status.",
        label: "Booking",
      });
    }

    return booking;
  } catch (cause: ShelfError | any) {
    throw new ShelfError({
      cause,
      message:
        cause?.message ||
        "Something went wrong while getting existing booking details.",
      additionalData: { bookingId },
      label: "Booking",
    });
  }
}

export function formatBookingsDates(bookings: Booking[], request: Request) {
  return bookings.map((b) => {
    if (b.from && b.to) {
      const from = new Date(b.from);
      const displayFrom = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(from);

      const to = new Date(b.to);
      const displayTo = getDateTimeFormat(request, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(to);

      return {
        ...b,
        displayFrom: displayFrom.split(","),
        displayTo: displayTo.split(","),
      };
    }
    return b;
  });
}

export async function getAvailableAssetsIdsForBooking(
  assetIds: Asset["id"][]
): Promise<string[]> {
  try {
    const selectedAssets = await db.asset.findMany({
      where: { id: { in: assetIds } },
      select: { status: true, id: true, kit: true },
    });
    if (selectedAssets.some((asset) => asset.kit)) {
      throw new ShelfError({
        cause: null,
        message: "Cannot add assets that belong to a kit.",
        label: "Booking",
      });
    }
    return selectedAssets.map((asset) => asset.id);
  } catch (cause: ShelfError | any) {
    throw new ShelfError({
      cause: cause,
      message: cause?.message
        ? cause.message
        : "Something went wrong while getting available assets.",
      label: "Assets",
    });
  }
}

/**
 * This function checks for the available assets.
 * and returns the ids and booking info.
 */
export async function processBooking(bookingId: string, assetIds: string[]) {
  try {
    const [finalAssetIds, bookingInfo] = await Promise.all([
      getAvailableAssetsIdsForBooking(assetIds),
      getExistingBookingDetails(bookingId),
    ]);

    if (!finalAssetIds.length) {
      throw new ShelfError({
        cause: null,
        message: "No assets available.",
        label: "Booking",
      });
    }

    return {
      finalAssetIds,
      bookingInfo,
    };
  } catch (cause) {
    let message = "Something went wrong while processing the booking.";
    if (isLikeShelfError(cause)) {
      message = cause.message;
    }

    throw new ShelfError({
      cause: cause,
      message,
      label: "Booking",
    });
  }
}
