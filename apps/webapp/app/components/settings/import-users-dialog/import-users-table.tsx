/**
 * Import Users Table
 *
 * Lists the rows of an uploaded users CSV (email and role) in the import
 * dialog. A role the file spells in a way no role matches shows as typed, so
 * the operator can spot the bad row.
 *
 * @see {@link file://./import-users-dialog.tsx}
 */
import type { CSSProperties } from "react";
import type { z } from "zod";
import {
  ROLE_LABELS,
  isOrganizationRole,
} from "~/utils/permissions/role-access";
import { tw } from "~/utils/tw";
import type { InviteUserFormSchema } from "../invite-user-dialog";

type ImportUsersTableProps = {
  className?: string;
  style?: CSSProperties;
  title: string;
  users: z.infer<typeof InviteUserFormSchema>[];
};

/**
 * Renders the imported users with each role's label.
 *
 * @param props.title - Heading above the table
 * @param props.users - Parsed CSV rows
 */
export default function ImportUsersTable({
  className,
  style,
  title,
  users,
}: ImportUsersTableProps) {
  return (
    <div
      className={tw(
        "relative w-full overflow-x-auto rounded-md border",
        className
      )}
      style={style}
    >
      <h4 className="px-6 py-3 text-left">{title}</h4>

      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase">
          <tr>
            <th scope="col" className="px-6 py-3">
              Email
            </th>
            <th scope="col" className="px-6 py-3">
              Role
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.email}>
              <td className="px-6 py-4">{user.email}</td>
              <td className="px-6 py-4">
                {isOrganizationRole(user.role)
                  ? ROLE_LABELS[user.role]
                  : user.role}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
