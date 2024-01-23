import {
  type Booking,
  type Prisma,
  type Organization,
  type Asset,
  BookingStatus,
  AssetStatus,
} from "@prisma/client";
import { db } from "~/database";
import { bookingUpdatesTemplateString } from "~/emails/bookings-updates-template";
import { calcTimeDifference } from "~/utils/date-fns";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { schedulerKeys } from "./constants";
import {
  assetReservedEmailContent,
  cancelledBookingEmailContent,
  completedBookingEmailContent,
  deletedBookingEmailContent,
  sendCheckinReminder,
} from "./email-helpers";
import type { ClientHint, SchedulerData } from "./types";

const cancelSheduler = async (b?: Booking | null) => {
  if (b?.activeSchedulerReference) {
    scheduler.cancel(b.activeSchedulerReference).catch((err) => {
      //no need to worry, workers will check the state of booking before handling, even if we fail to cancel here
      // eslint-disable-next-line no-console
      console.warn(`Failed to cancel the scheduler for booking ${b.id}`, err);
    });
  }
};

export const scheduleNextBookingJob = async ({
  data,
  when,
  key,
}: {
  data: SchedulerData;
  when: Date;
  key: string;
}) => {
  const id = await scheduler.sendAfter(key, data, {}, when);
  await db.booking.update({
    where: { id: data.id },
    data: { activeSchedulerReference: id },
  });
};

const updateBookinAssetStates = (
  booking: Booking & { assets: Asset[] },
  status: AssetStatus
) =>
  db.asset.updateMany({
    where: {
      status: { not: status },
      id: { in: booking.assets.map((a) => a.id) },
    },
    data: { status },
  });

const commonInclude: Prisma.BookingInclude = {
  custodianTeamMember: true,
  custodianUser: true,
};
//client should pass new Date().toIsoString() to action handler for to and from
export const upsertBooking = async (
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
  hints: ClientHint
) => {
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
    const custodianUser = await db.teamMember.findUnique({
      where: {
        id: custodianTeamMemberId,
      },
      select: {
        id: true,
        user: true,
      },
    });

    if (!custodianUser) {
      throw new ShelfStackError({ message: "Cannot find team member" });
    }

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
      await cancelSheduler(oldBooking);
    }

    //update
    const res = await db.booking.update({
      where: { id },
      data,
      include: {
        ...commonInclude,
        assets: true,
        _count: {
          select: { assets: true },
        },
      },
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
      promises.push(updateBookinAssetStates(res, newAssetStatus));
    }
    if (res.from && booking.status === BookingStatus.RESERVED) {
      promises.push(cancelSheduler(res));
      const when = new Date(res.from);
      when.setHours(when.getHours() - 1); //1hour before send checkout reminder
      promises.push(
        scheduleNextBookingJob({
          data: { id: res.id, hints },
          key: schedulerKeys.checkoutReminder,
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
          const custodian = `${res.custodianUser?.firstName} ${res.custodianUser?.lastName}` ||
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
          let html = bookingUpdatesTemplateString({ booking: res, heading: `Booking confirmation for ${custodian}`, assetCount: res.assets.length })

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
            html = bookingUpdatesTemplateString({ booking: res, heading: `Your booking has been completed: "${res.name}".`, assetCount: res._count.assets })
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
            html = bookingUpdatesTemplateString({ booking: res, heading: `Your booking has been cancelled: "${res.name}".`, assetCount: res._count.assets })
          }

          promises.push(
            sendEmail({
              to: email,
              subject,
              text,
              html
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
    await cancelSheduler(res);
    const when = new Date(res.from);
    when.setHours(when.getHours() - 1); //1hour before send checkout reminder
    await scheduleNextBookingJob({
      data: { id: res.id, hints },
      key: schedulerKeys.checkoutReminder,
      when,
    });
  }
  return res;
};

export async function getBookings({
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
}: {
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
}) {
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
    // @TODO if status of the booking is ONGOING, the assets added should have their status updated to CHECKED_OUT
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
      },
      orderBy: { from: "asc" },
    }),
    db.booking.count({ where }),
  ]);

  return { bookings, bookingCount };
}

export const removeAssets = async (
  booking: Pick<Booking, "id"> & { assetIds: Asset["id"][] }
) => {
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
   * Because prisma doesnt support transactional execution of nested queries, we need to do them in 2 steps, because if the disconnect runs first,
   * the updateMany will not find the assets in the booking anymore and wont update them
   */
  await db.asset.updateMany({
    where: { id: { in: assetIds } },
    data: { status: AssetStatus.AVAILABLE },
  });
  return b;
};

export const deleteBooking = async (
  booking: Pick<Booking, "id">,
  hints: ClientHint
) => {
  const { id } = booking;
  const activeBooking = await db.booking.findFirst({
    where: {
      id,
      status: { in: [BookingStatus.OVERDUE, BookingStatus.ONGOING] },
    },
  });
  const b = await db.booking.delete({
    where: { id },
    include: {
      ...commonInclude,
      assets: true,
      _count: { select: { assets: true } },
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
    const html = bookingUpdatesTemplateString({ booking: b, heading: `Your booking has been deleted: "${b.name}".`, assetCount: b._count.assets })

    await sendEmail({
      to: email,
      subject,
      text,
      html
    });
  }

  /** Because assets in an active booking have a special status, we need to update them if we delete a booking */
  if (activeBooking) {
    await updateBookinAssetStates(b, AssetStatus.AVAILABLE);
  }
  await cancelSheduler(b);

  return b;
};

export const getBooking = async (booking: Pick<Booking, "id">) => {
  const { id } = booking;

  return db.booking.findFirst({
    where: { id },
    include: {
      ...commonInclude,
      assets: {
        include: {
          category: true,
          custody: true,
          bookings: {
            select: {
              id: true,
              status: true,
            },
          },
        },
      },
    },
  });
};
