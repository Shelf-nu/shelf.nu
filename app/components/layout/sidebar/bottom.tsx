import type { User } from "@prisma/client";
import { Link } from "@remix-run/react";
import { useAtom } from "jotai";
import ProfilePicture from "~/components/user/profile-picture";
import { LogoutButton } from "~/modules/auth";
import { toggleMobileNavAtom } from "./atoms";

interface Props {
  user: Pick<User, "username" | "email">;
}

export default function SidebarBottom({ user }: Props) {
  const [, toggleMobileNav] = useAtom(toggleMobileNavAtom);
  return (
    <div className="bottom gap-2">
      <Link
        to="settings"
        className="flex-1 rounded-lg p-1 hover:bg-gray-100"
        onClick={toggleMobileNav}
      >
        <div className="flex items-center gap-3">
          <ProfilePicture width="w-10" height="h-10" />
          <div className="user-credentials flex-1 text-[14px] transition-all duration-200 ease-linear">
            <div className="line-clamp-1 block text-ellipsis font-semibold">
              {user.username}
            </div>
            <p
              className="line-clamp-1 block text-ellipsis"
              data-test-id="userEmail"
            >
              {user.email}
            </p>
          </div>
        </div>
      </Link>

      <LogoutButton
        className="logout-btn h-8 w-8 transition-all duration-200 ease-linear"
        onClick={toggleMobileNav}
      />
    </div>
  );
}
