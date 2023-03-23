import { useUserData } from "~/hooks";
import { tw } from "~/utils";

/** Returns the current user's profile picture */
export default function ProfilePicture({
  size = 64,
}: {
  /** Size of the item in px. Default is 64 */
  size?: number;
}) {
  let user = useUserData();

  const sizeClasses = `h-[${size}] w-[${size}]`;
  return user ? (
    <img
      src={user.profilePicture || "/images/default_pfp.jpg"}
      alt={`${user.username}`}
      className={`${sizeClasses} rounded-[10px]`}
    />
  ) : null;
}
