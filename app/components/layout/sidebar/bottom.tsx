import { Link } from "@remix-run/react";

import ProfilePicture from "~/components/user/profile-picture";

import type { User } from "~/database";

import { LogoutButton } from "~/modules/auth";

interface Props {
  user: User;
}

export default function SidebarBottom({ user }: Props) {
  return (
    <div className="bottom">
      <Link to="settings" className="rounded-lg p-1 hover:bg-gray-100">
        <div className="flex items-center gap-3">
          <ProfilePicture width="w-10" height="h-10" />
          <div className="user-credentials max-w-[120px] flex-1 text-[14px] transition-all duration-200 ease-linear">
            <div className="line-clamp-1 block text-ellipsis font-semibold">
              {user.username}
            </div>
            <p className="line-clamp-1 block text-ellipsis">{user.email}</p>
          </div>
        </div>
      </Link>

      <LogoutButton className="logout-btn h-8 w-8 transition-all duration-200 ease-linear" />
    </div>
  );
}
