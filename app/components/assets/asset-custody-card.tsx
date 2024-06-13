import type { TeamMember, User } from "@prisma/client";
import { Link } from "@remix-run/react";
import { resolveTeamMemberName } from "~/utils/user";
import { Card } from "../shared/card";

/**
 * Renders the Asset Custody Card
 * It can be either a card showing custody via a booking or custody via a long term checkout
 */
export function AssetCustodyCard({
  booking,
  isSelfService,
  custody,
}: {
  booking:
    | {
        id: string;
        name: string;
        from: string | null;
        custodianUser: Omit<User, "createdAt" | "updatedAt"> | null;
        custodianTeamMember: Omit<
          TeamMember,
          "createdAt" | "updatedAt" | "deletedAt"
        > | null;
      }
    | null
    | undefined;
  isSelfService: boolean;
  custody: {
    dateDisplay: string;
    custodian: {
      name: string;
      user?: Partial<
        Pick<User, "firstName" | "lastName" | "profilePicture" | "email">
      > | null;
    };
  } | null;
}) {
  /** We return null if user is selfService */
  if (isSelfService) {
    return null;
  }

  /* If custody is present, we render the card showing custody */
  if (custody?.dateDisplay) {
    return (
      <Card className="my-3">
        <div className="flex items-center gap-3">
          <img
            src={
              custody.custodian?.user?.profilePicture ||
              "/static/images/default_pfp.jpg"
            }
            alt="custodian"
            className="size-10 rounded"
          />
          <div>
            <p className="">
              In custody of{" "}
              <span className="font-semibold">
                {resolveTeamMemberName(custody.custodian)}
              </span>
            </p>
            <span>Since {custody.dateDisplay}</span>
          </div>
        </div>
      </Card>
    );
  }

  /** If booking is present, we render the card showing custody via booking */
  if (booking) {
    let teamMemberName = "";
    if (booking.custodianUser) {
      teamMemberName = resolveTeamMemberName({
        name: `${booking.custodianUser?.firstName || ""} ${
          booking.custodianUser?.lastName || ""
        }`,
        user: {
          firstName: booking.custodianUser?.firstName || "",
          lastName: booking.custodianUser?.lastName || "",
          profilePicture: booking.custodianUser?.profilePicture || null,
        },
      });
    } else if (booking.custodianTeamMember) {
      teamMemberName = resolveTeamMemberName({
        name: booking.custodianTeamMember.name,
      });
    }

    return (
      <Card className="my-3">
        <div className="flex items-center gap-3">
          <img
            src={
              booking.custodianUser?.profilePicture ??
              "/static/images/default_pfp.jpg"
            }
            alt="custodian"
            className="size-10 rounded"
          />
          <div>
            <p className="">
              In custody of{" "}
              <span className="font-semibold">{teamMemberName} </span>
              via
            </p>
            <Link to={`/bookings/${booking.id}`} className="underline">
              {booking.name}
            </Link>
            <span> Since {booking.from}</span>
          </div>
        </div>
      </Card>
    );
  }

  return null;
}
