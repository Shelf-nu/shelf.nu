import type { z } from "zod";
import { tw } from "~/utils/tw";
import type { InviteUserFormSchema } from "../invite-user-dialog";

type ImportUsersTableProps = {
  className?: string;
  style?: React.CSSProperties;
  title: string;
  users: z.infer<typeof InviteUserFormSchema>[];
};

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
              <td className="px-6 py-4">{user.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
