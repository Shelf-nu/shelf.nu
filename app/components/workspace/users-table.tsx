import type { User } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import type { WithDateFields } from "~/modules/types";
import type { loader } from "~/routes/_layout+/settings.team";
import { tw } from "~/utils";
import { Button } from "../shared";
import { Table, Td, Th, Tr } from "../table";
import ProfilePicture from "../user/profile-picture";

export const UsersTable = ({
  users,
}: {
  users: WithDateFields<User, string>[];
}) => {
  const { owner } = useLoaderData<typeof loader>();
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
          <Table>
            <thead>
              <Tr>
                <Th>
                  <div className=" text-md font-semibold text-gray-900">
                    Users
                  </div>
                  <div>{users.length + 1} items</div>
                </Th>
                <Th className="hidden md:table-cell">
                  <Button variant="primary" to={`invite-user`}>
                    <span className=" whitespace-nowrap">Invite a user</span>
                  </Button>
                </Th>
              </Tr>
            </thead>
            <tbody>
              <tr key={owner.id} className={tw("hover:bg-gray-50")}>
                <Td className="w-full">
                  <div className="flex items-center gap-3">
                    <ProfilePicture width="w-10" height="h-10" />
                    <div className="user-credentials flex-1 text-[14px] transition-all duration-200 ease-linear">
                      <div className="line-clamp-1 block text-ellipsis font-semibold">
                        {owner.username}
                      </div>
                      <p className="line-clamp-1 block text-ellipsis">
                        {owner.email}
                      </p>
                    </div>
                  </div>
                </Td>
                <Td className="text-right">Actions</Td>
              </tr>
              {users.map((item) => (
                <tr key={item.id} className={tw("hover:bg-gray-50")}>
                  <Td className="w-full">
                    <div className="flex items-center justify-between">
                      <span className="text-text-sm font-medium text-gray-900">
                        {item.firstName} {item.lastName}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-right">Actions</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>
    </div>
  );
};
