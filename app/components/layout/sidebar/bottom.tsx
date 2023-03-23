import { Link } from "@remix-run/react";

import ProfilePicture from "~/components/user/profile-picture";

import type { User } from "~/database";

import { LogoutButton } from "~/modules/auth";
import styles from "./styles.module.css";

interface Props {
  user: User;
}

export default function SidebarBottom({ user }: Props) {
  return (
    <div className={styles.bottom}>
      <Link to="settings" className="rounded-lg p-1 hover:bg-gray-100">
        <div className="flex items-center gap-3">
          <ProfilePicture />
          <div className="flex-1 text-[14px]">
            <div className="font-semibold">{user.username}</div>
            <div>{user.email}</div>
          </div>
        </div>
      </Link>

      <LogoutButton className="h-8 w-8" />
    </div>
  );
}
