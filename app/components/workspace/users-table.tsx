import type { User } from "@prisma/client";
import type { WithDateFields } from "~/modules/types";
import { tw } from "~/utils";
import { EmptyState } from "../list/empty-state";
import { Button } from "../shared";
import { Table, Td, Th, Tr } from "../table";

export const UsersTable = ({
  users,
}: {
  users: WithDateFields<User, string>[];
}) => {
  const hasItems = users.length > 0;

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
          {!hasItems ? (
            <EmptyState
              customContent={{
                title: "No users added to your workspace",
                text: "What are you waiting for? Invite your first collaborator!",
                newButtonRoute: `add-member`,
                newButtonContent: "Invite a user",
              }}
              modelName={{
                singular: "user",
                plural: "users",
              }}
            />
          ) : (
            <>
              <Table>
                <thead>
                  <Tr>
                    <Th>
                      <div className=" text-md font-semibold text-gray-900">
                        Non-registered members
                      </div>
                      <div>
                        {users.length} {users.length > 1 ? "items" : "item"}{" "}
                      </div>
                    </Th>
                    <Th className="hidden md:table-cell">
                      <Button variant="primary" to={`add-member`}>
                        <span className=" whitespace-nowrap">
                          Invite a user
                        </span>
                      </Button>
                    </Th>
                  </Tr>
                </thead>
                <tbody>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
};
