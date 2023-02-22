import { LogoutButton } from "~/modules/auth";
import styles from "./styles.module.css";

interface Props {
  user: {
    name: string;
    email: string;
    photo: string;
  };
}

export default function SidebarBottom({ user }: Props) {
  return (
    <div className={styles.bottom}>
      <div className="flex flex-1 items-center gap-3">
        <img
          src={user.photo}
          alt={`${user.name} profile picture`}
          className="h-10 w-10 rounded-full"
        />

        <div className="flex-1 text-[14px]">
          <div className="font-semibold">{user.name}</div>
          <div>{user.email}</div>
        </div>
      </div>
      <LogoutButton />
    </div>
  );
}
