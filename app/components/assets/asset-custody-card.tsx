import type { TeamMember, User } from "@prisma/client";
import { Link } from "@remix-run/react";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { Button } from "../shared/button";
import { Card } from "../shared/card";

/**
 * Renders the Asset Custody Card
 * It can be either a card showing custody via a booking or custody via a long term checkout
 */
export function CustodyCard({
  booking,
  hasPermission,
  custody,
}: {
  booking:
    | {
        id: string;
        name: string;
        from: string | null;
        custodianUser: Omit<
          User,
          "createdAt" | "updatedAt" | "deletedAt"
        > | null;
        custodianTeamMember: Omit<
          TeamMember,
          "createdAt" | "updatedAt" | "deletedAt"
        > | null;
      }
    | null
    | undefined;
  hasPermission: boolean;
  custody: {
    dateDisplay: string;
    custodian: {
      name: string;
      userId?: string | null;
      user?: Partial<
        Pick<User, "firstName" | "lastName" | "profilePicture" | "email">
      > | null;
    };
  } | null;
}) {
  const { roles } = useUserRoleHelper();
  const canViewTeamMemberUsers = userHasPermission({
    roles,
    entity: PermissionEntity.teamMemberProfile,
    action: PermissionAction.read,
  });
  /** We return null if user is selfService */
  if (!hasPermission || !custody) {
    return null;
  }
  const fullName = resolveTeamMemberName(custody.custodian);

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
              {canViewTeamMemberUsers && custody?.custodian?.userId ? (
                <Button
                  to={`/settings/team/users/${custody.custodian.userId}/assets`}
                  variant="link"
                  className={tw(
                    "mt-px font-semibold text-gray-900 hover:text-gray-700 hover:underline",
                    "[&_.external-link-icon]:opacity-0 [&_.external-link-icon]:duration-100 [&_.external-link-icon]:ease-in-out [&_.external-link-icon]:hover:opacity-100"
                  )}
                  target="_blank"
                >
                  {fullName}
                </Button>
              ) : (
                <span className="mt-px">{fullName}</span>
              )}
              <span className="font-semibold">{}</span>
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
