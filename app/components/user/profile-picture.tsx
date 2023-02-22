import type { User } from "~/database";

interface Props {
  user: User;
}

export default function ProfilePicture({ user }: Props) {
  return (
    <img
      src={user.profilePicture || "/images/default_pfp.jpg"}
      alt={`${user.name} profile picture`}
      className="h-10 w-10 rounded-full"
    />
  );
}
