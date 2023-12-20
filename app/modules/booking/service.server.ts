import {
  type Booking,
  type Prisma,
  type Organization,
  type Asset,
  BookingStatus,
  AssetStatus,
} from "@prisma/client";
import { db } from "~/database";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { schedulerKeys } from "./constants";
import { assetReservedEmailContent } from "./email-helpers";
import type { SchedulerData } from "./types";

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
  >
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
    data.custodianTeamMember = {
      disconnect: true,
    };
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
        )
      ) {
        //booking has ended, make asset available
        newAssetStatus = AssetStatus.AVAILABLE;
      }
      //cancel any active schedulers
      await cancelSheduler(oldBooking);
    } else if (booking.status === BookingStatus.ONGOING) {
      //booking is ongoing, make asset checked out
      //no need to worry about overdue as the previous state is always ongoing
      newAssetStatus = AssetStatus.CHECKED_OUT;
    }

    //update
    const res = await db.booking.update({
      where: { id },
      data,
      include: { ...commonInclude, assets: true },
    });
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
          data: { id: res.id },
          key: schedulerKeys.checkoutReminder,
          when,
        })
      );
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
      data: { id: res.id },
      key: schedulerKeys.checkoutReminder,
      when,
    });
  }

  /** Handle email notification when booking status changes */
  console.log("res", res);
  console.log("data", data);
  if (
    data.status &&
    (data.status === BookingStatus.RESERVED ||
      data.status === BookingStatus.COMPLETE)
  ) {
    const email = res.custodianUser?.email;
    console.log("email", email);
    if (email) {
      let subject = `Booking reserved`;
      let text = assetReservedEmailContent({
        bookingName: res.name,
        assetsCount: res.assets.length,
        custodian:
          `${res.custodianUser?.firstName} ${res.custodianUser?.lastName}` ||
          (res.custodianTeamMember?.name as string),
        from: res.from?.toISOString() as string,
        to: res.to?.toISOString() as string,
        bookingId: res.id,
      });

      if (data.status === BookingStatus.COMPLETE) {
        subject = `Booking complete`;
        text = `Your checkin complete for booking ${res.name}`;
      }
      await sendEmail({
        to: email,
        subject,
        text,
      });
    }
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
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current org */
  let where: Prisma.BookingWhereInput = { organizationId };

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
      notIn: [BookingStatus.ARCHIVED], // By default we dont show archived bookings
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

  return db.booking.update({
    where: { id },
    include: commonInclude,
    data: {
      assets: {
        disconnect: assetIds.map((id) => ({ id })),
      },
    },
  });
};

export const deleteBooking = async (booking: Pick<Booking, "id">) => {
  const { id } = booking;
  const activeBooking = await db.booking.findFirst({
    where: {
      id,
      status: { in: [BookingStatus.OVERDUE, BookingStatus.ONGOING] },
    },
  });
  const b = await db.booking.delete({
    where: { id },
    include: { ...commonInclude, assets: true },
  });
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
        },
      },
    },
  });
};
