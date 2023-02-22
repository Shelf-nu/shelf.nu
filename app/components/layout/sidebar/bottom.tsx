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
      <div className="flex flex-1 items-center gap-3">
        <ProfilePicture user={user} />
        <div className="flex-1 text-[14px]">
          <div className="font-semibold">{user.name}</div>
          <div>{user.email}</div>
        </div>
      </div>
      <LogoutButton />
    </div>
  );
}
