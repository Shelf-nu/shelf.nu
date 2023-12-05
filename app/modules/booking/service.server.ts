import {
  type Booking,
  type Prisma,
  type Organization,
  type Asset,
  BookingStatus,
} from "@prisma/client";
import { db } from "~/database";
import { ShelfStackError } from "~/utils/error";
import { sendEmail } from "~/utils/mail.server";
import { scheduler } from "~/utils/scheduler.server";
import { schedulerKeys } from "./constants";

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
    //update
    return await db.booking.update({
      where: { id },
      data,
      include: commonInclude,
    });
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
  if (data.from) {
    const when = new Date(data.from as string);
    when.setHours(when.getHours() - 1); //1hour before send checkout reminder
    const jobId = await scheduler.sendAfter(
      schedulerKeys.checkoutReminder,
      { id: res.id },
      {},
      when
    );
    await db.booking.update({
      where: { id: res.id },
      data: { activeSchedulerReference: jobId },
    });
  }
  if (
    data.status &&
    (data.status === BookingStatus.RESERVED ||
      data.status === BookingStatus.COMPLETE)
  ) {
    const email = res.custodianUser?.email;
    if (email) {
      let subject = `Booking reserved`;
      let text = `Your assets have been reserved by ${res.organization.name} under ${res.name}`;
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
      include: commonInclude,
      orderBy: { createdAt: "desc" },
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

  const b = await db.booking.delete({
    where: { id },
    include: { ...commonInclude, assets: true },
  });
  if (b.activeSchedulerReference)
    await scheduler.cancel(b.activeSchedulerReference);
  return b;
};

export const getBooking = async (booking: Pick<Booking, "id">) => {
  const { id } = booking;

  return db.booking.findFirst({
    where: { id },
    include: { ...commonInclude, assets: true },
  });
};
