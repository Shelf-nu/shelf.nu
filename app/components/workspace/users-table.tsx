import { useMemo } from "react";
import type { Invite, InviteStatuses } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/settings.team";
import { tw } from "~/utils";
import { TeamUsersActionsDropdown } from "./users-actions-dropdown";
import { Button } from "../shared";
import { Table, Td, Th } from "../table";

export const UsersTable = () => {
  const { owner, teamMembersWithUserOrInvite } = useLoaderData<typeof loader>();
  return (
    <div className="mb-6 flex gap-16">
      <div className="w-1/4">
        <div className="text-text-sm font-medium text-gray-700">Users</div>
        <p className="text-sm text-gray-600">User linked to your workspace.</p>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <div
          className={tw(
            "-mx-4 overflow-x-auto border border-gray-200  bg-white md:mx-0 md:rounded-[12px]"
          )}
        >
          <div className="flex w-full items-center justify-between border-b px-6 py-4">
            <div>
              <div className=" text-md font-semibold text-gray-900">Users</div>
              <div>{teamMembersWithUserOrInvite.length + 1} items</div>
            </div>
            <div className="text-right">
              <Button variant="primary" to={`invite-user`}>
                <span className=" whitespace-nowrap">Invite a user</span>
              </Button>
            </div>
          </div>
          <Table>
            <thead>
              <tr>
                <Th className="hidden md:table-cell">Name</Th>
                <Th className="hidden md:table-cell">Role</Th>
                <Th className="hidden md:table-cell">Status</Th>
                <Th> </Th>
              </tr>
            </thead>
            <tbody>
              <UserRow
                name={`${owner.firstName} ${owner.lastName}`}
                email={owner.email}
                img={owner.profilePicture || "/images/default_pfp.jpg"}
                role="Owner"
                status="ACCEPTED"
              />
              {teamMembersWithUserOrInvite.map((tm) => (
                <UserRow
                  key={tm.id}
                  name={
                    tm?.userId && tm.user
                      ? `${tm.user.firstName} ${tm.user.lastName}`
                      : tm.name
                  }
                  // We just get the first one as we only need the email, and the email should be the same in all those receivedInvites
                  invite={tm.receivedInvites[0]}
                  role="Administrator"
                  status={tm.userId ? "ACCEPTED" : "PENDING"}
                  img={tm?.user?.profilePicture || "/images/default_pfp.jpg"}
                />
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
};

const UserRow = ({
  name,
  img,
  invite,
  email,
  status = "PENDING",
  role,
}: {
  name: string;
  img?: string;
  invite?:
    | Pick<Invite, "id" | "teamMemberId" | "inviteeEmail" | "status">
    | undefined;
  email?: string;
  status?: InviteStatuses;
  role?: string;
}) => (
  <tr className={tw("hover:bg-gray-50")}>
    <Td className="w-full">
      <div className="flex items-center gap-3">
        <img
          src={img || "/images/default_pfp.jpg"}
          className={"h-10 w-10 rounded-[4px]"}
          alt={`${name}'s profile`}
        />
        <div className="user-credentials flex-1 text-[14px] transition-all duration-200 ease-linear">
          <div className="line-clamp-1 block text-ellipsis font-semibold">
            {name}
          </div>
          <p className="line-clamp-1 block text-ellipsis">
            {email || invite?.inviteeEmail}
          </p>
        </div>
      </div>
    </Td>
    <Td className=" text-gray-600">{role}</Td>
    <Td className="!pr-10">
      <InviteStatusBadge status={invite?.status || status} />
    </Td>
    <Td>
      {role !== "Owner" ? (
        <TeamUsersActionsDropdown inviteStatus={invite?.status || status} />
      ) : null}
    </Td>
  </tr>
);

const InviteStatusBadge = ({ status }: { status: InviteStatuses }) => {
  const colorClasses = useMemo(() => {
    switch (status) {
      case "PENDING":
        return "bg-gray-200 text-gray-700";
      case "ACCEPTED":
        return "bg-success-50 text-success-700";
      case "REJECTED":
        return "bg-error-50 text-error-700";
      default:
        return "bg-gray-200 text-gray-700";
    }
  }, [status]);

  return (
    <span
      className={tw(
        "inline-flex justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700",
        colorClasses
      )}
    >
      <span>{status}</span>
    </span>
  );
};
